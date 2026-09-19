import * as React from "react";

type DynamicOptions = {
  ssr?: boolean;
  loading?: () => React.ReactNode;
};

/**
 * Minimal Vite stand-in for next/dynamic. Loads the default export lazily.
 */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: React.ComponentType<P> }>,
  options: DynamicOptions = {}
): React.ComponentType<P> {
  const Lazy = React.lazy(loader);

  function DynamicComponent(props: P) {
    return (
      <React.Suspense fallback={options.loading ? options.loading() : null}>
        <Lazy {...props} />
      </React.Suspense>
    );
  }

  DynamicComponent.displayName = "NextDynamicShim";
  return DynamicComponent;
}
