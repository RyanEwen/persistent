/**
 * "Is a back-aware dialog open?", asked from outside the component tree.
 *
 * The native Back handler (`native/useNativeBack.ts`) has to let a dialog swallow
 * Back before it navigates anywhere, but the open-dialog stack is module state
 * inside `BackAwareModal.tsx` — and exporting a plain function from a component
 * file breaks React Fast Refresh for that file.
 *
 * So the modal registers a probe here instead of this module keeping its own
 * count: a second counter would be a second source of truth, free to drift from
 * the real stack the moment either side changes.
 */
let probe: () => boolean = () => false

/** Called once by BackAwareModal with a reader over its live dialog stack. */
export function setBackAwareDialogProbe(fn: () => boolean): void {
  probe = fn
}

export function hasOpenBackAwareDialog(): boolean {
  return probe()
}
