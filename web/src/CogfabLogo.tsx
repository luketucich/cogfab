export function CogfabLogo() {
  return (
    <picture className="cogfab-brand">
      <source media="(max-width: 520px)" srcSet="/brand/cogfab-mark.png" />
      <img className="cogfab-brand__image" src="/brand/cogfab-lockup-light.png" alt="Cogfab" />
    </picture>
  );
}
