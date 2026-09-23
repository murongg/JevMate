export default function Bot({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`bot ${className}`}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path
        d="M29 4h6v9h-6zM13 15h38v5h5v27h-5v6H13v-6H8V20h5zM3 26h5v14H3zM56 26h5v14h-5z"
        fill="currentColor"
      />
      <path d="M15 22h34v22H15z" fill="var(--bot-screen, #101410)" />
      <path className="bot-eyes" d="M20 27h7v7h-7zM37 27h7v7h-7z" fill="currentColor" />
      <path d="M26 39h12v3H26zM17 53h9v6h-9zM38 53h9v6h-9z" fill="currentColor" />
    </svg>
  );
}
