import { useState } from 'react';
import { AlertTriangle, Cloud, CloudOff, Loader2, LogIn, LogOut, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { useAccount } from '../lib/hooks';
import type { CloudAccount } from '../lib/account';
import type { CloudSync } from '../lib/sync';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Modal, cn } from './ui';

function syncMeta(sync: CloudSync | null) {
  if (!sync) return { label: 'Sign in again to sync', icon: AlertTriangle, tone: 'text-critical', spin: false };
  if (sync.status === 'syncing') return { label: 'Syncing…', icon: Loader2, tone: 'text-muted', spin: true };
  if (sync.status === 'offline') return { label: sync.hasUnsynced ? 'Offline, changes saved on this device' : 'Offline', icon: CloudOff, tone: 'text-muted', spin: false };
  if (sync.status === 'error') return { label: sync.needsSignIn ? 'Sign in again' : 'Sync problem', icon: AlertTriangle, tone: 'text-critical', spin: false };
  if (sync.hasUnsynced) return { label: 'Changes waiting to sync', icon: Cloud, tone: 'text-muted', spin: false };
  if (sync.status === 'synced') return { label: 'Synced', icon: Cloud, tone: 'text-good', spin: false };
  return { label: 'Waiting to sync', icon: Cloud, tone: 'text-muted', spin: false };
}

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.2-4.8 3.2-8Z" />
    <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z" />
    <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8Z" />
    <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z" />
  </svg>
);

function Avatar({ account, size = 'sm' }: { account: CloudAccount; size?: 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const user = account.user;
  const cls = size === 'lg' ? 'h-12 w-12 text-lg' : 'h-7 w-7 text-xs';
  if (user?.avatarUrl && !failed) return <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn('shrink-0 rounded-full object-cover', cls)} />;
  return <span className={cn('hero-card flex shrink-0 items-center justify-center rounded-full font-semibold text-white', cls)} aria-hidden>{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}</span>;
}

/** Compact header control: sign in, or the signed-in account with its sync state. */
export function AccountButton() {
  const account = useAccount();
  if (!account) return null;
  const open = () => { window.location.hash = '/settings?section=account'; };
  if (account.state !== 'signed-in') {
    return <Button size="sm" variant="secondary" icon={LogIn} aria-label="Sign in" disabled={account.state === 'loading'} onClick={open}><span className="hidden sm:inline">Sign in</span></Button>;
  }
  const m = syncMeta(account.sync);
  return (
    <button type="button" onClick={open} aria-label={`Account: ${account.user?.email || account.user?.name}. ${m.label}`} title={m.label}
      className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-subtle" data-testid="account-button">
      <Avatar account={account} />
      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface"><m.icon className={cn('h-3 w-3', m.tone, m.spin && 'animate-spin')} aria-hidden /></span>
    </button>
  );
}

export function AccountCard() {
  const account = useAccount();
  const [confirmOut, setConfirmOut] = useState(false);
  if (!account) return null;
  const signOut = async (force = false) => {
    setConfirmOut(false);
    if ((await account.signOut(force)) === 'unsynced') setConfirmOut(true);
  };
  if (account.state !== 'signed-in') {
    return (
      <Card data-testid="account-card">
        <CardHeader title="Account and sync" icon={UserRound} description="Sign in to keep your progress safe and use it on all your devices." />
        <CardBody className="space-y-3">
          <Button variant="secondary" disabled={account.state === 'loading'} loading={account.state === 'loading'} onClick={() => void account.signIn()} data-testid="google-sign-in"><GoogleMark /> Continue with Google</Button>
          <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Only your account can read your progress. The app still works without signing in, but progress then stays in this browser.</p>
        </CardBody>
      </Card>
    );
  }
  const sync = account.sync;
  const m = syncMeta(sync);
  return (
    <Card data-testid="account-card">
      <CardHeader title="Account and sync" icon={UserRound} description="Your progress is saved on this device and synced to your account." />
      <CardBody className="space-y-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar account={account} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{account.user?.name}</div>
            <div className="truncate text-xs text-muted">{account.user?.email}</div>
          </div>
        </div>
        <div className="rounded-xl border border-line/70 bg-subtle/50 px-3 py-2.5 text-sm" role="status" aria-live="polite" data-testid="sync-status">
          <span className={cn('flex items-center gap-2 font-medium', m.tone)}><m.icon className={cn('h-4 w-4', m.spin && 'animate-spin')} aria-hidden />{m.label}</span>
          {sync?.error && <p className="mt-1 text-xs text-ink2">{sync.error}</p>}
          {sync?.lastSyncedAt && <p className="mt-1 text-xs text-muted">Last synced {new Date(sync.lastSyncedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!sync || sync.needsSignIn
            ? <Button variant="primary" icon={LogIn} onClick={() => void account.signIn()}>Sign in again</Button>
            : <Button icon={RefreshCw} disabled={sync.status === 'syncing'} onClick={() => void sync.syncNow()}>Sync now</Button>}
          <Button variant="ghost" icon={LogOut} loading={account.busy} onClick={() => void signOut()} data-testid="sign-out">Sign out</Button>
        </div>
      </CardBody>
      {confirmOut && (
        <ConfirmDialog title="Some changes are not synced" confirmLabel="Sign out and discard" onClose={() => setConfirmOut(false)} onConfirm={() => void signOut(true)}>
          Signing out removes this account’s copy from this device, so changes that have not reached the cloud would be lost. Stay signed in and reconnect to keep them.
        </ConfirmDialog>
      )}
    </Card>
  );
}

/** First sign-in with existing progress on this device: the user decides whether it joins the account. */
export function GuestImportDialog() {
  const account = useAccount();
  const s = account?.guestPrompt;
  if (!account || !s) return null;
  const exams = Object.keys(s.exams).length;
  const sessions = Object.values(s.exams).reduce((a, e) => a + e.sessions, 0);
  const topics = Object.values(s.exams).reduce((a, e) => a + e.topicRecords + e.subtopicRecords, 0);
  return (
    <Modal open onClose={() => void account.keepGuestSeparate()} title="Add this device’s progress to your account?"
      footer={<><Button disabled={account.busy} onClick={() => void account.keepGuestSeparate()}>Keep separate</Button><Button variant="primary" loading={account.busy} onClick={() => void account.addGuestProgress()} data-testid="add-guest-progress">Add to my account</Button></>}>
      <p className="text-sm text-ink2">This browser has progress saved before you signed in: <strong className="text-ink">{exams} exam{exams === 1 ? '' : 's'}, {topics} topic record{topics === 1 ? '' : 's'}, and {sessions} practice session{sessions === 1 ? '' : 's'}</strong>.</p>
      <p className="mt-2 text-xs text-muted">Adding it combines it with your account and removes nothing. Choose Keep separate if this progress belongs to someone else using this device.</p>
    </Modal>
  );
}
