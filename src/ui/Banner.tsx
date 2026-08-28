/**
 * One line, above everything, for a condition the user needs to know about but
 * which should not stop them playing (§3.1, §12.4).
 */
export function Banner({ tone, children }: { tone: 'warn' | 'bad'; children: React.ReactNode }) {
  const colour = tone === 'bad' ? 'border-miss text-miss' : 'border-lamp text-lamp';
  return (
    <div
      role="status"
      className={`rounded border ${colour} bg-panel px-3 py-2 text-center text-xs leading-snug`}
    >
      {children}
    </div>
  );
}
