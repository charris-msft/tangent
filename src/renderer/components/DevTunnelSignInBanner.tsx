import { useEffect, useState } from 'react'

type BannerStatus = 'idle' | 'prompt' | 'signing-in' | 'success' | 'error'

/**
 * Banner shown when a remote agent launch fails because the user isn't
 * signed in to dev tunnels. Clicking "Sign in" runs `devtunnel user login -g`
 * which opens a browser window for GitHub OAuth.
 */
export function DevTunnelSignInBanner(): JSX.Element | null {
  const [status, setStatus] = useState<BannerStatus>('idle')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    const api = (window as any).tangentAPI?.devbox
    if (!api) return

    const unsubs: Array<() => void> = []

    unsubs.push(api.onAuthRequired((data: { message: string }) => {
      setStatus('prompt')
      setMessage(data?.message || 'Dev tunnel sign-in required.')
    }))
    unsubs.push(api.onSignInStarted(() => {
      setStatus('signing-in')
      setMessage('Opening browser to sign in with GitHub…')
    }))
    unsubs.push(api.onSignInComplete((data: { message: string }) => {
      setStatus('success')
      setMessage(data?.message || 'Signed in. You can relaunch your remote agent now.')
      // Auto-dismiss after a few seconds
      window.setTimeout(() => setStatus('idle'), 5000)
    }))
    unsubs.push(api.onSignInFailed((data: { message: string }) => {
      setStatus('error')
      setMessage(data?.message || 'Sign-in failed.')
    }))

    return () => { unsubs.forEach(fn => fn()) }
  }, [])

  if (status === 'idle') return null

  const handleSignIn = async (): Promise<void> => {
    const api = (window as any).tangentAPI?.devbox
    if (!api?.signIn) return
    await api.signIn()
  }

  const handleDismiss = (): void => setStatus('idle')

  const isBusy = status === 'signing-in'
  const isPrompt = status === 'prompt' || status === 'error'
  const bgClass =
    status === 'success'
      ? 'bg-emerald-900/70 border-emerald-600/50'
      : status === 'error'
        ? 'bg-red-900/70 border-red-600/50'
        : 'bg-amber-900/70 border-amber-600/50'

  return (
    <div
      className={`absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-md border text-sm text-slate-100 shadow-lg backdrop-blur-sm ${bgClass}`}
      role="status"
    >
      <span className="flex-1 max-w-[60ch]">
        {status === 'success' ? '✓ ' : status === 'error' ? '⚠ ' : '🔐 '}
        {message}
      </span>
      {isPrompt && (
        <button
          onClick={handleSignIn}
          className="px-3 py-1 rounded bg-slate-100 text-slate-900 hover:bg-white text-xs font-medium"
        >
          Sign in
        </button>
      )}
      {isBusy && (
        <span className="text-xs text-slate-300 italic">Waiting for browser…</span>
      )}
      <button
        onClick={handleDismiss}
        className="text-slate-300 hover:text-white text-xs px-1"
        aria-label="Dismiss"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
