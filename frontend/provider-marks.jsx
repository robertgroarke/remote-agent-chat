import providerAssetManifest from '../provider-assets/manifest.json';

const WEB_PROVIDER_MARKS = Object.freeze(Object.fromEntries(
  providerAssetManifest.providers.map(provider => [
    provider.provider_id,
    Object.freeze({
      accessibleName: provider.accessible_name,
      light: `/provider-assets/${provider.render.web.light}`,
      dark: `/provider-assets/${provider.render.web.dark}`,
      darkTint: provider.render.web.dark_tint || '',
    }),
  ]),
));

export function resolveProviderMark(providerId) {
  return WEB_PROVIDER_MARKS[String(providerId || '')] || null;
}

export function ProviderMark({ providerId, providerName }) {
  const mark = resolveProviderMark(providerId);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => setFailed(false), [providerId]);

  const accessibleName = mark?.accessibleName || String(providerName || 'Unknown provider');
  if (!mark || failed) {
    return (
      <span
        className="usage-dashboard-provider-mark usage-dashboard-provider-mark-fallback"
        data-provider-mark-id={providerId}
        role="img"
        aria-label={`${accessibleName} provider mark unavailable`}
      >
        <span aria-hidden="true">{accessibleName}</span>
      </span>
    );
  }

  return (
    <span
      className="usage-dashboard-provider-mark"
      data-provider-mark-id={providerId}
      role="img"
      aria-label={`${accessibleName} provider mark`}
    >
      <img
        className="usage-dashboard-provider-mark-image usage-dashboard-provider-mark-light"
        src={mark.light}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
      <img
        className={`usage-dashboard-provider-mark-image usage-dashboard-provider-mark-dark${mark.darkTint ? ' usage-dashboard-provider-mark-tinted' : ''}`}
        src={mark.dark}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
