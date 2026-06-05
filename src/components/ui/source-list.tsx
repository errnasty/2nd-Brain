import type { ReactNode } from "react";

/**
 * Shared citation/source row used by both the Ask tab and the Daily Brief.
 *
 * Layout: [badge] [icon] [title / subtitle] [trailing] ........ [right]
 *
 * The main region (badge → trailing) is a single clickable target. Pass
 * `onClick` to make it a button (internal navigation) or `href` to make it an
 * external anchor. `right` holds extra controls (external link, mark-read)
 * that sit OUTSIDE the main click target so they stay independently clickable.
 */
export function SourceRow({
  badge,
  icon,
  title,
  subtitle,
  trailing,
  onClick,
  href,
  right,
}: {
  badge?: ReactNode;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  right?: ReactNode;
}) {
  const inner = (
    <>
      {badge}
      {icon}
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="w-full truncate group-hover:underline">{title}</span>
        {subtitle && (
          <span className="w-full truncate text-[10px] text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {trailing}
    </>
  );
  const mainCls = "flex min-w-0 flex-1 items-center gap-2 text-left";
  return (
    <div className="group flex items-center gap-2 rounded-md p-2 text-xs transition-colors hover:bg-accent/50">
      {onClick ? (
        <button onClick={onClick} className={mainCls}>
          {inner}
        </button>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className={mainCls}>
          {inner}
        </a>
      )}
      {right}
    </div>
  );
}

/** The numbered circle chip shared by source rows. */
export function SourceBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
      {n}
    </span>
  );
}
