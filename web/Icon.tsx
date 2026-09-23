import {
  ArrowRight,
  ArrowSquareOut,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  DownloadSimple,
  GitBranch,
  Tray,
  Key,
  MagnifyingGlass,
  Stack,
  Tag,
  X,
  XCircle,
} from '@phosphor-icons/react';
const icons = {
  arrow: ArrowRight,
  external: ArrowSquareOut,
  refresh: ArrowClockwise,
  previous: CaretLeft,
  next: CaretRight,
  check: Check,
  applied: CheckCircle,
  download: DownloadSimple,
  repo: GitBranch,
  pending: Tray,
  search: MagnifyingGlass,
  all: Stack,
  tag: Tag,
  close: X,
  dismissed: XCircle,
};
export default function Icon({
  name,
  className = '',
}: {
  name: keyof typeof icons;
  className?: string;
}) {
  const Glyph = icons[name];
  return <Glyph size={18} weight="regular" aria-hidden="true" className={`icon ${className}`} />;
}
