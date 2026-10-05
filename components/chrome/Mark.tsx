/** Two ink dots and the road between them, overprinted. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="9" cy="21" r="5.5" fill="var(--blue)" />
      <circle cx="21" cy="9" r="5.5" fill="var(--fire)" style={{ mixBlendMode: "multiply" }} />
      <path d="M9 21 C 9 12, 21 18, 21 9" stroke="var(--ink)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
