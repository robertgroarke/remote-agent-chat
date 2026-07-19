#include <windows.h>
#include <shlwapi.h>
#include <cwchar>

#pragma data_seg(".racguard")
volatile LONG g_guard_enabled = 0;
wchar_t g_target_path_fragment[MAX_PATH] = L"\\WindowsApps\\OpenAI.Codex_";
#pragma data_seg()
#pragma comment(linker, "/SECTION:.racguard,RWS")

static bool IsTargetProcess() {
    wchar_t path[32768] = {};
    DWORD length = GetModuleFileNameW(nullptr, path, static_cast<DWORD>(_countof(path)));
    if (length == 0 || length >= _countof(path)) return false;
    return StrStrIW(path, g_target_path_fragment) != nullptr;
}

extern "C" __declspec(dllexport) BOOL WINAPI RacConfigureCbtGuard(
        const wchar_t* target_path_fragment, BOOL enabled) {
    if (!enabled) {
        InterlockedExchange(&g_guard_enabled, 0);
        return TRUE;
    }
    if (target_path_fragment == nullptr || target_path_fragment[0] == L'\0') return FALSE;
    if (wcslen(target_path_fragment) >= _countof(g_target_path_fragment)) return FALSE;
    if (InterlockedCompareExchange(&g_guard_enabled, 0, 0) != 0) return FALSE;
    wcscpy_s(g_target_path_fragment, target_path_fragment);
    InterlockedExchange(&g_guard_enabled, 1);
    return TRUE;
}

extern "C" __declspec(dllexport) LRESULT CALLBACK RacCbtHookProc(
        int code, WPARAM w_param, LPARAM l_param) {
    if (code < 0 || InterlockedCompareExchange(&g_guard_enabled, 0, 0) == 0 || !IsTargetProcess()) {
        return CallNextHookEx(nullptr, code, w_param, l_param);
    }
    if (code == HCBT_CREATEWND) {
        auto* create = reinterpret_cast<CBT_CREATEWNDW*>(l_param);
        if (create != nullptr && create->lpcs != nullptr) {
            create->lpcs->dwExStyle |= WS_EX_NOACTIVATE;
            create->lpcs->x = -32000;
            create->lpcs->y = -32000;
        }
    } else if (code == HCBT_ACTIVATE) {
        HWND window = reinterpret_cast<HWND>(w_param);
        LONG_PTR style = GetWindowLongPtrW(window, GWL_EXSTYLE);
        SetWindowLongPtrW(window, GWL_EXSTYLE, style | WS_EX_NOACTIVATE);
        SetWindowPos(window, nullptr, -32000, -32000, 0, 0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        return 1;
    }
    return CallNextHookEx(nullptr, code, w_param, l_param);
}

BOOL WINAPI DllMain(HINSTANCE, DWORD, LPVOID) {
    return TRUE;
}
