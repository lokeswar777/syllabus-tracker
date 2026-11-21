/**
 * Settings → Data: storage status, JSON backup/restore (validated, with confirmation and safety snapshot),
 * CSV exports, local restore points, integrity check, reset.
 */
import { useRef, useState } from 'react';
import { Database, Download, Upload, Trash2, HardDrive, ShieldCheck, History, FileSpreadsheet, CloudOff, CheckCircle2, AlertTriangle, RotateCcw, Camera, Lock } from 'lucide-react';
import { useApp, useAsync } from '../lib/hooks';
import { CSV_KINDS, BOM, type CsvKind } from '../lib/csv';
import { describeCounts, type ValidationResult, type BackupSummary } from '../lib/backup';
import type { ImportMode } from '../lib/store';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, LoadingBlock, Modal, Select, cn } from './ui';

const fmtBytes = (n: number | null) => (n === null ? '–' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`);
const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const REASON: Record<string, string> = { daily: 'Daily (automatic)', manual: 'Created by you', 'before-import': 'Before an import', 'before-restore': 'Before a restore', 'before-reset': 'Before reset', migration: 'Migration' };

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataManagement() {
  return (
    <div className="space-y-5">
      <StorageCard />
      <BackupCard />
      <CsvCard />
      <SnapshotsCard />
      <IntegrityCard />
      <ResetCard />
    </div>
  );
}

function StorageCard() {
  const { store } = useApp();
  const [tick, setTick] = useState(0);
  const info = useAsync(() => store.storageInfo(), [tick]);
  const kind = store.storageKind;
  return (
    <Card data-testid="storage-card">
      <CardHeader title="Where your data is stored" icon={HardDrive} />
      <CardBody className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'indexeddb' ? <Badge tone="good" icon={CheckCircle2}>Browser database (IndexedDB)</Badge> : kind === 'localstorage' ? <Badge tone="warn" icon={AlertTriangle}>localStorage (fallback)</Badge> : <Badge tone="critical" icon={AlertTriangle}>Memory only: not saved</Badge>}
          {info.data && <Badge icon={Lock} tone={info.data.persisted ? 'good' : 'neutral'}>{info.data.persisted ? 'Protected from automatic clean-up' : 'Best-effort storage'}</Badge>}
          {info.data?.usage != null && <span className="text-xs text-muted">Using {fmtBytes(info.data.usage)}{info.data.quota ? ` of ${fmtBytes(info.data.quota)} available` : ''}</span>}
        </div>
        <p className="flex items-start gap-2 rounded-lg border border-line bg-subtle/50 p-3 text-xs text-ink2" data-testid="local-only-notice">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <span><strong className="text-ink">No cloud sync is configured.</strong> Your preparation data stays in this browser on this device only; other browsers and devices do not see it.
            To move to another device, export a backup here and import it there. Clearing this site’s data in the browser deletes it, so keep regular backups.</span>
        </p>
        {kind === 'indexeddb' && info.data && !info.data.persisted && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Lock} onClick={async () => { const ok = await store.requestPersistence(); store.toast(ok ? 'success' : 'info', ok ? 'The browser will keep this data even when storage runs low.' : 'The browser did not grant persistent storage; data is kept on a best-effort basis. Keep backups.'); setTick(tick + 1); }}>Ask the browser to keep this data</Button>
            <span className="text-2xs text-muted">Prevents automatic eviction when the disk is nearly full.</span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SummaryTable({ current, incoming, examName }: { current: BackupSummary; incoming: BackupSummary; examName: (id: string) => string }) {
  const exams = [...new Set([...Object.keys(current.exams), ...Object.keys(incoming.exams)])];
  const row = (label: string, a: number | string, b: number | string) => <tr key={label}><td>{label}</td><td className="tabular text-right">{a}</td><td className="tabular text-right">{b}</td></tr>;
  return (
    <div className="scroll-x rounded-lg border border-line">
      <table className="table-base min-w-[22rem]" data-testid="import-summary">
        <thead><tr><th /><th className="text-right">Your data now</th><th className="text-right">In the backup</th></tr></thead>
        <tbody>
          {exams.map((e) => {
            const c = current.exams[e], i = incoming.exams[e];
            const f = (x?: BackupSummary['exams'][string]) => (x ? `${x.topicRecords + x.subtopicRecords} records · ${x.sessions} sessions · ${x.revisions} revisions` : '–');
            return row(examName(e), f(c), f(i));
          })}
          {row('Shared concept records', current.sharedConcepts, incoming.sharedConcepts)}
          {row('Study plans (days / tasks)', `${current.plans} / ${current.tasks}`, `${incoming.plans} / ${incoming.tasks}`)}
          {row('Target exams', current.targets.map(examName).join(', ') || '–', incoming.targets.map(examName).join(', ') || '–')}
          {row('Custom weights · sync preferences', `${current.customWeights} · ${current.syncPreferences}`, `${incoming.customWeights} · ${incoming.syncPreferences}`)}
          {row('Trend history days', current.historyDays, incoming.historyDays)}
        </tbody>
      </table>
    </div>
  );
}

function BackupCard() {
  const { store } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ name: string; data: unknown; v: ValidationResult & { current: BackupSummary } } | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const data = await store.exportData();
      download(`syllabus-tracker-backup-${store.today()}.json`, JSON.stringify(data, null, 2), 'application/json');
      store.toast('success', 'Backup downloaded');
    } catch (e) { store.toast('error', `Export failed: ${(e as Error).message}`); } finally { setExporting(false); }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      let data: unknown;
      try { data = JSON.parse(await f.text()); } catch { throw new Error('The file is not valid JSON.'); }
      const v = await store.previewImport(data);
      const hasData = Object.keys(v.current.exams).length > 0;
      setMode(hasData ? 'merge' : 'replace');
      setPreview({ name: f.name, data, v });
    } catch (e) {
      store.toast('error', `Import failed: ${(e as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const { report, snapshot } = await store.importData(preview.data, mode);
      store.toast('success', mode === 'merge' ? `Backup merged: added ${describeCounts(report?.added ?? {})}; updated ${describeCounts(report?.updated ?? {})}.` : 'Backup restored.');
      if (snapshot) store.toast('info', 'Your previous data was saved as a restore point (Settings → Restore points).');
      setPreview(null);
    } catch (e) { store.toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const v = preview?.v;
  return (
    <Card data-testid="backup-card">
      <CardHeader title="Backup and restore" icon={Database} description="A complete, checksum-verified JSON backup of your progress, practice, notes, plans and settings." />
      <CardBody className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Download} onClick={doExport} loading={exporting} data-testid="export">Export backup (JSON)</Button>
        <Button icon={Upload} onClick={() => fileRef.current?.click()} data-testid="import-button">Import backup…</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="import-file" />
      </CardBody>
      {preview && v && (
        <Modal open wide onClose={() => !busy && setPreview(null)} title="Restore from backup"
          footer={<><Button onClick={() => setPreview(null)} disabled={busy}>Cancel</Button>
            <Button variant={mode === 'replace' ? 'danger' : 'primary'} disabled={!v.ok} loading={busy} onClick={confirm} data-testid="import-confirm">{mode === 'merge' ? 'Merge into my data' : 'Replace my data'}</Button></>}>
          <div className="space-y-4 text-sm" data-testid="import-preview">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{preview.name}</span>
              <Badge>format {v.formatVersion ?? '?'}</Badge>
              <span className="text-xs text-muted">exported {fmtTime(v.exportedAt)}</span>
              {v.checksum === 'valid' && <Badge tone="good" icon={ShieldCheck}>checksum verified</Badge>}
              {v.checksum === 'absent' && <Badge>no checksum (older backup)</Badge>}
              {v.checksum === 'invalid' && <Badge tone="critical" icon={AlertTriangle}>checksum mismatch</Badge>}
            </div>
            {v.errors.length > 0 ? (
              <div className="rounded-lg border border-critical/30 bg-critical/5 p-3" data-testid="import-errors">
                <p className="mb-1 font-medium text-critical">This backup cannot be imported:</p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink2">{v.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}{v.errors.length > 12 && <li>… and {v.errors.length - 12} more</li>}</ul>
              </div>
            ) : (
              <>
                {v.summary && <SummaryTable current={v.current} incoming={v.summary} examName={(id) => store.examName(id)} />}
                {v.warnings.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted" data-testid="import-warnings">{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                <fieldset className="space-y-2" aria-label="Import mode">
                  <label className={cn('flex cursor-pointer gap-3 rounded-lg border p-3', mode === 'merge' ? 'border-accent/50 bg-accent/5' : 'border-line')}>
                    <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-1" data-testid="mode-merge" />
                    <span><span className="font-medium">Merge with my data</span> <Badge tone="good">safe</Badge>
                      <span className="block text-xs text-muted">Nothing you have is deleted. Practice sessions and revisions are combined without duplicates; for a record that exists in both, the more recently updated one is kept. Your settings, targets and custom weights stay as they are.</span></span>
                  </label>
                  <label className={cn('flex cursor-pointer gap-3 rounded-lg border p-3', mode === 'replace' ? 'border-critical/50 bg-critical/5' : 'border-line')}>
                    <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1" data-testid="mode-replace" />
                    <span><span className="font-medium">Full restore</span>
                      <span className="block text-xs text-muted">Your current data is replaced by the backup exactly as it was exported.</span></span>
                  </label>
                </fieldset>
                <p className="text-xs text-muted">Before importing, a restore point of your current data is created automatically, so this can be undone from “Restore points”.</p>
              </>
            )}
          </div>
        </Modal>
      )}
    </Card>
  );
}

function CsvCard() {
  const { store } = useApp();
  const [kind, setKind] = useState<CsvKind>('overall');
  const [scope, setScope] = useState<'current' | 'with-data' | 'all'>(store.activeExamId ? 'with-data' : 'all');
  const [busy, setBusy] = useState(false);
  const examIds = scope === 'current' ? [store.activeExamId].filter(Boolean) as string[] : scope === 'with-data' ? store.examsWithData() : store.exams.map((e) => e.examId);
  const run = async () => {
    setBusy(true);
    try {
      const csv = await store.exportCsv(kind, examIds);
      download(`syllabus-tracker-${kind}-${store.today()}.csv`, BOM + csv, 'text/csv;charset=utf-8');
      store.toast('success', `${CSV_KINDS.find((k) => k.kind === kind)!.label} exported (${csv.split('\r\n').length - 2} rows)`);
    } catch (e) { store.toast('error', `CSV export failed: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader title="Export as spreadsheet (CSV)" icon={FileSpreadsheet} description="Opens in Excel, Google Sheets or LibreOffice. Values are the same as on screen." />
      <CardBody className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Report" hint={CSV_KINDS.find((k) => k.kind === kind)?.description}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as CsvKind)} data-testid="csv-kind">{CSV_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</Select>
        </Field>
        <Field label="Exams" hint={`${examIds.length} exam${examIds.length === 1 ? '' : 's'}`}>
          <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} data-testid="csv-scope">
            {store.activeExamId && <option value="current">Current exam ({store.examName(store.activeExamId)})</option>}
            <option value="with-data">Exams with saved progress</option>
            <option value="all">All 9 exams</option>
          </Select>
        </Field>
        <Button icon={Download} onClick={run} loading={busy} disabled={!examIds.length} data-testid="csv-export">Download CSV</Button>
      </CardBody>
    </Card>
  );
}

function SnapshotsCard() {
  const { store, version } = useApp();
  const [tick, setTick] = useState(0);
  const list = useAsync(() => store.listSnapshots(), [tick, version]);
  const [restoring, setRestoring] = useState<string | null>(null);
  if (!store.snapshotsSupported) return null;
  return (
    <Card data-testid="snapshots-card">
      <CardHeader title="Restore points" icon={History} description="Automatic copies of your data kept in this browser: one per day (last 7) and one before every import, restore or reset (last 10)."
        action={<Button size="sm" icon={Camera} onClick={async () => { await store.run(() => store.snapshot('manual'), 'Restore point created'); setTick(tick + 1); }} data-testid="snapshot-create">Create now</Button>} />
      <CardBody>
        {!list.data ? <LoadingBlock rows={2} /> : list.data.length === 0 ? <p className="text-xs text-muted">No restore points yet. One is created automatically each day once you have data.</p> : (
          <ul className="divide-y divide-line/70 rounded-lg border border-line" data-testid="snapshot-list">
            {list.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1"><span className="font-medium">{fmtTime(s.createdAt)}</span> <span className="text-xs text-muted">· {REASON[s.reason] ?? s.reason} · {fmtBytes(s.bytes)}</span></span>
                <Button size="sm" variant="ghost" icon={Download} onClick={async () => { const b = await store.snapshotAsBackup(s.id); download(`syllabus-tracker-restore-point-${s.createdAt.slice(0, 10)}.json`, JSON.stringify(b, null, 2), 'application/json'); }}>Download</Button>
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setRestoring(s.id)}>Restore</Button>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete restore point" onClick={async () => { await store.deleteSnapshot(s.id); setTick(tick + 1); }} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {restoring && (
        <Modal open onClose={() => setRestoring(null)} title="Restore this point?"
          footer={<><Button onClick={() => setRestoring(null)}>Cancel</Button><Button variant="danger" onClick={async () => { await store.run(() => store.restoreSnapshot(restoring), 'Restore point applied'); setRestoring(null); setTick(tick + 1); }}>Restore</Button></>}>
          <p className="text-sm text-ink2">Your data will be replaced by this restore point. Your current data is saved as a new restore point first, so you can switch back.</p>
        </Modal>
      )}
    </Card>
  );
}

function IntegrityCard() {
  const { store } = useApp();
  const [result, setResult] = useState<Awaited<ReturnType<typeof store.checkIntegrity>> | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Data integrity" icon={ShieldCheck} description="Checks structure, required fields, duplicate IDs and references to exams and topics."
        action={<Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { setResult(await store.checkIntegrity()); } finally { setBusy(false); } }} data-testid="integrity-run">Run check</Button>} />
      {result && (
        <CardBody className="space-y-2 text-sm" data-testid="integrity-result">
          {result.errors.length === 0 ? <p className="flex items-center gap-2 text-good"><CheckCircle2 className="h-4 w-4" />No problems found ({Object.keys(result.summary?.exams ?? {}).length} exams with data checked).</p>
            : <ul className="list-disc pl-5 text-xs text-critical">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {result.warnings.filter((w) => !w.startsWith('The backup has no')).map((w) => <p key={w} className="text-xs text-muted">{w}</p>)}
          {result.orphans.length > 0 && <p className="text-xs text-muted">Records outside the current syllabus (kept, not counted): {result.orphans.slice(0, 8).join(', ')}{result.orphans.length > 8 ? ` +${result.orphans.length - 8}` : ''}</p>}
        </CardBody>
      )}
    </Card>
  );
}

function ResetCard() {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <Card>
      <CardHeader title="Reset" icon={Trash2} description="Deletes all progress, practice, plans and settings in this browser. The syllabus and weightage databases are not affected."
        action={<Button size="sm" variant="ghost" className="text-critical hover:text-critical" onClick={() => setOpen(true)}>Reset all data…</Button>} />
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Reset all data?"
          footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" disabled={text !== 'RESET'} onClick={async () => { await store.run(() => store.resetAll(), 'All data was reset. A restore point of the previous data was kept.'); setOpen(false); }}>Reset everything</Button></>}>
          <p className="text-sm text-ink2">{store.snapshotsSupported ? 'A restore point of your current data is created first.' : 'Export a backup first: this cannot be undone.'}</p>
          <Field label="Type RESET to confirm" className="mt-3"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
        </Modal>
      )}
    </Card>
  );
}
