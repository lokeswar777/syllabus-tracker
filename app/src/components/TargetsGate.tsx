import type { ReactNode } from 'react';
import { Crosshair } from 'lucide-react';
import { useApp } from '../lib/hooks';
import { Button, Card, EmptyState } from './ui';

/** Planner pages need target exams (Phase 5). Shows an explicit choice instead of silently inventing targets. */
export function TargetsGate({ children, onSettings }: { children: ReactNode; onSettings: () => void }) {
  const { store } = useApp();
  if (store.planner.settings.targets.length > 0) return <>{children}</>;
  const active = store.activeExamId;
  return (
    <Card data-testid="no-targets">
      <EmptyState icon={Crosshair} title="No target exams selected"
        description="Smart priorities, the study planner and the revision tracker plan across your target exams. Choose them (with importance and exam dates) in Settings."
        action={<div className="flex flex-wrap justify-center gap-2">
          {active && <Button variant="primary" onClick={() => store.run(() => store.planner.setTargets([{ examId: active, importance: 100 }]), `${store.examName(active)} set as your target exam`)}>Use {store.examName(active)} as target</Button>}
          <Button onClick={onSettings}>Choose in Settings</Button>
        </div>} />
    </Card>
  );
}
