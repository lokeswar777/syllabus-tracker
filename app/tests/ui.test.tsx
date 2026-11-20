// Renders the real application (real engines + real data, in-memory storage) and drives it like a user.
import { describe, expect, test } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { AppStore } from '../src/lib/store';
import { pct } from '../src/lib/format';
import { defaults, fixedClock, makeStore, memoryStorage, nodeLoader } from './helpers';

const go = (route: string) => { window.location.hash = `/${route}`; window.dispatchEvent(new HashChangeEvent('hashchange')); };
async function renderApp(store: AppStore, route = 'dashboard') {
  window.location.hash = `/${route}`;
  const user = userEvent.setup();
  const view = render(<App store={store} />);
  return { user, view };
}

describe('application UI', () => {
  test('loading state, then the exam chooser; choosing an exam shows its real dashboard values', async () => {
    const store = new AppStore({ loader: nodeLoader(), storage: memoryStorage(), defaults, clock: fixedClock });
    window.location.hash = '/dashboard';
    const user = userEvent.setup();
    render(<App store={store} />);
    expect(screen.getByTestId('app-loading')).toBeInTheDocument();
    await act(async () => { await store.init(); });
    expect(await screen.findByTestId('welcome')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /SSC CGL/ }));
    await screen.findByTestId('page-dashboard');
    const r = store.report()!;
    expect(screen.getByTestId('stat-completion')).toHaveTextContent(pct(r.summary.syllabusCompletion));
    expect(screen.getByTestId('stat-completed')).toHaveTextContent(String(r.summary.topicCounts.completed));
    expect(screen.getByTestId('stat-remaining')).toHaveTextContent(String(r.summary.topicCounts.total - r.summary.topicCounts.completed));
  });

  test('error state when data cannot be loaded, with a working retry', async () => {
    let fail = true;
    const base = nodeLoader();
    const loader = { ...base, listExams: () => (fail ? Promise.reject(new Error('Could not load syllabus.json (HTTP 404)')) : base.listExams()), loadExam: base.loadExam, loadMapping: base.loadMapping };
    const store = new AppStore({ loader, storage: memoryStorage(), defaults, clock: fixedClock });
    await store.init();
    const { user } = await renderApp(store);
    expect(screen.getByTestId('app-error')).toHaveTextContent('syllabus.json');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('welcome')).toBeInTheDocument();
  });

  test('exam and stage switching recalculate the dashboard from the engine', async () => {
    const store = await makeStore();
    await store.selectExam('ssc-cgl');
    store.engine.setStatus('quant.percentage', 'completed');
    const { user } = await renderApp(store);
    expect(await screen.findByRole('heading', { name: 'SSC CGL dashboard' })).toBeInTheDocument();
    const cgl = screen.getByTestId('stat-completion').textContent;
    await user.selectOptions(screen.getByTestId('exam-select'), 'sbi-po');
    expect(await screen.findByRole('heading', { name: 'SBI PO dashboard' })).toBeInTheDocument();
    expect(screen.getByTestId('stat-completion')).toHaveTextContent(pct(store.report()!.summary.syllabusCompletion));
    expect(screen.getByTestId('stat-completion').textContent).not.toBe(cgl);
    await user.selectOptions(screen.getByTestId('stage-select'), 'mains');
    await waitFor(() => expect(store.report()!.scope.stageId).toBe('mains'));
    expect(screen.getByTestId('stat-completion')).toHaveTextContent(pct(store.report()!.summary.syllabusCompletion));
    const stageName = store.report()!.stages.find((x) => x.stageId === 'mains')!.name;
    expect(screen.getByRole('heading', { name: 'SBI PO dashboard' }).parentElement).toHaveTextContent(`${stageName} ·`);
  });

  test('syllabus tracker: search, filters and inline status edits saved through the engine', async () => {
    const storage = memoryStorage();
    const store = await makeStore({ storage });
    await store.selectExam('ssc-cgl');
    const { user } = await renderApp(store, 'syllabus');
    await screen.findByTestId('page-syllabus');
    const total = store.report()!.summary.topicCounts.total;
    expect(screen.getByTestId('visible-count')).toHaveTextContent(`${total} of ${total} topics`);
    await user.type(screen.getByTestId('syllabus-search'), 'percentage');
    // matches topic names and subtopic names
    const r0 = store.report()!;
    const expected = Object.values(r0.topics).filter((t) => t.inScope && (t.name.toLowerCase().includes('percentage') || t.subtopicIds.some((id) => r0.subtopics[id].name.toLowerCase().includes('percentage')))).length;
    await waitFor(() => expect(screen.getByTestId('visible-count')).toHaveTextContent(`${expected} of ${total}`));
    expect(expected).toBeLessThan(total);
    const row = screen.getAllByTestId('topic-quant.percentage')[0]; // listed under each stage it belongs to
    await user.selectOptions(within(row).getByLabelText('Status of Percentage'), 'concept-completed');
    expect(store.report()!.topics['quant.percentage'].status).toBe('concept-completed');
    await store.flush();
    const saved = (await storage.read('progress')) as { exams: Record<string, { topics: Record<string, { status: string }> }> };
    expect(saved.exams['ssc-cgl'].topics['quant.percentage'].status).toBe('concept-completed');
    // status filter
    await user.clear(screen.getByTestId('syllabus-search'));
    await user.selectOptions(screen.getByTestId('filter-status'), 'concept-completed');
    await waitFor(() => expect(screen.getByTestId('visible-count')).toHaveTextContent(`1 of ${total}`));
    // pending filter excludes completed topics
    store.engine.setStatus('quant.average', 'completed');
    await user.selectOptions(screen.getByTestId('filter-status'), 'pending');
    await waitFor(() => expect(screen.getByTestId('visible-count')).toHaveTextContent(`${total - 1} of ${total}`));
  });

  test('logging practice from a topic updates accuracy everywhere', async () => {
    const store = await makeStore();
    await store.selectExam('sbi-po');
    const { user } = await renderApp(store, 'syllabus');
    await user.type(await screen.findByTestId('syllabus-search'), 'Simplification');
    const row = await screen.findByTestId('topic-quant.simplification');
    await user.click(within(row).getAllByRole('button')[0]);
    await user.type(within(row).getByLabelText('Questions attempted'), '25');
    await user.type(within(row).getByLabelText('Correct answers'), '20');
    await user.click(within(row).getByRole('button', { name: 'Log practice' }));
    await waitFor(() => expect(store.report()!.topics['quant.simplification'].attempted).toBe(25));
    expect(store.report()!.topics['quant.simplification'].accuracy).toBe(80);
    act(() => go('practice'));
    expect(await screen.findByTestId('pa-attempted')).toHaveTextContent('25');
    expect(screen.getByTestId('pa-accuracy')).toHaveTextContent('80%');
  });

  test('planner pages ask for target exams explicitly, then show Phase 5 recommendations', async () => {
    const store = await makeStore();
    await store.selectExam('ssc-cgl');
    const { user } = await renderApp(store, 'priorities');
    expect(await screen.findByTestId('no-targets')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use SSC CGL as target' }));
    expect(await screen.findByTestId('page-priorities')).toBeInTheDocument();
    const rec = (await store.planner.getRecommendations({ limit: 1 })).recommendations[0];
    expect(await screen.findByTestId(`rec-${rec.topicId}`)).toHaveTextContent(rec.name);
    expect(screen.getByTestId('group-Critical')).toBeInTheDocument();
  });

  test('study planner: generating, completing without outcome leaves progress untouched', async () => {
    const store = await makeStore();
    await store.selectExam('ssc-cgl');
    await store.planner.setTargets([{ examId: 'ssc-cgl', importance: 100 }]);
    const { user } = await renderApp(store, 'planner');
    await screen.findByTestId('page-planner');
    await user.click(within(screen.getByTestId('day-detail')).getByRole('button', { name: /Generate plan/ }));
    await screen.findByTestId('day-tasks');
    const before = JSON.stringify(store.engine.getExamRecords('ssc-cgl'));
    const first = within(screen.getByTestId('task-0'));
    await user.click(first.getByRole('button', { name: 'Complete' }));
    await user.click(screen.getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(store.planner.getDailyPlan('2026-11-20')!.tasks[0].status).toBe('completed'));
    expect(JSON.stringify(store.engine.getExamRecords('ssc-cgl'))).toBe(before);
    expect(store.planner.getDailyPlan('2026-11-20')!.tasks.slice(1).every((t) => t.status === 'pending')).toBe(true);
  });

  test('settings: revision intervals and daily hours are saved through the planner', async () => {
    const store = await makeStore();
    await store.selectExam('ssc-cgl');
    const { user } = await renderApp(store, 'settings');
    const iv = await screen.findByTestId('intervals');
    await user.clear(iv);
    await user.type(iv, '2, 4, 9');
    await user.click(within(iv.parentElement!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.planner.config().revision.intervalsDays).toEqual([2, 4, 9]));
    const hours = screen.getByLabelText('Daily study hours');
    await user.clear(hours);
    await user.type(hours, '3.5');
    await user.click(within(hours.parentElement!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.planner.settings.dailyHours).toBe(3.5));
  });

  test('empty states: no practice, no revisions', async () => {
    const store = await makeStore();
    await store.selectExam('ibps-clerk');
    await renderApp(store, 'practice');
    expect(await screen.findByText('No practice logged in this scope')).toBeInTheDocument();
    act(() => go('dashboard'));
    expect(await screen.findByText('No revisions due')).toBeInTheDocument();
    expect(screen.getByText('No history yet')).toBeInTheDocument();
  });
});
