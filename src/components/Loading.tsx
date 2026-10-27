export function Loading({ label = 'Loading', progress }: { label?: string; progress?: number }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black">
      <div className="heading text-sm tracking-[0.4em] text-white">STARSHIP</div>
      <div className="h-px w-56 overflow-hidden bg-white/15">
        <div
          className={progress === undefined ? 'h-full w-1/3 animate-[loading_1.2s_ease-in-out_infinite] bg-white' : 'h-full bg-white transition-[width]'}
          style={progress === undefined ? undefined : { width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="label">{label}</div>
      <style>{`@keyframes loading{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  )
}
