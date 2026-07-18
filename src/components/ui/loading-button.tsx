import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export interface LoadingButtonProps extends Omit<ButtonProps, "asChild"> {
  loading: boolean;
  /** Label while loading; defaults to children so the width stays stable. */
  loadingText?: React.ReactNode;
}

/**
 * Button with a built-in pending state: while `loading`, it disables itself,
 * announces busy to assistive tech, and shows a leading spinner. Callers with
 * a leading icon should hide it while loading (the spinner takes its slot) so
 * the button doesn't jump.
 */
const LoadingButton = React.forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ loading, loadingText, children, disabled, ...props }, ref) => (
    <Button ref={ref} disabled={disabled || loading} aria-busy={loading} {...props}>
      {loading && <Spinner />}
      {loading ? (loadingText ?? children) : children}
    </Button>
  ),
);
LoadingButton.displayName = "LoadingButton";

export { LoadingButton };
