import { useEffect, useId, useRef } from 'react'

/** Modal confirmation shared by destructive-ish actions (remove from
 * watchlist, log out). Escape or a scrim click cancels; the neutral
 * Continue button gets initial focus so a stray Enter can't confirm a
 * dialog the user hasn't read. */
export default function ConfirmDialog({
  title,
  children,
  onContinue,
  onCancel,
}: {
  title: string
  children: React.ReactNode
  onContinue: () => void
  onCancel: () => void
}) {
  const continueRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    continueRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="pop-in w-full max-w-sm rounded-xl border border-edge bg-card p-6 shadow-xl shadow-scrim"
      >
        <h2 id={titleId} className="font-semibold text-lg mb-1.5">
          {title}
        </h2>
        <p id={descId} className="text-sm text-ink-mute mb-5 leading-relaxed">
          {children}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            ref={continueRef}
            onClick={onContinue}
            className="rounded-lg border border-edge bg-card-2 hover:bg-edge px-4 py-2
                       pointer-coarse:py-3 text-sm font-semibold cursor-pointer
                       transition-colors duration-150"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-down-deep hover:bg-down text-white px-4 py-2
                       pointer-coarse:py-3 text-sm font-semibold cursor-pointer
                       transition-colors duration-150"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
