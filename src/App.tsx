import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Divider,
  Elevation,
  FormGroup,
  HTMLSelect,
  Icon,
  InputGroup,
  ProgressBar,
  Tab,
  Tabs,
  Tag,
  TextArea
} from '@blueprintjs/core';

type StepStatus = 'draft' | 'submitted' | 'confirmed' | 'returned';
type ProcessStatus = 'draft' | 'in-review' | 'frozen' | 'revising';
type ViewId = 'editor' | 'review' | 'permits' | 'compare';

type PermitStatus = 'pending' | 'approved' | 'rejected' | 'active' | 'expired' | 'revoked' | 'drifted';
type PermitEventType =
  | 'created'
  | 'withdrawn'
  | 'approved'
  | 'rejected'
  | 'activated'
  | 'expired'
  | 'revoked'
  | 'drifted'
  | 'restored'
  | 'cascade-invalidated';
type DeviationFieldKey =
  | 'title'
  | 'purpose'
  | 'materials'
  | 'equipment'
  | 'amount'
  | 'duration'
  | 'hazards'
  | 'controls'
  | 'safetyNote'
  | 'expectedResult';

interface ReviewComment {
  id: string;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

interface PermitFieldChange {
  field: DeviationFieldKey;
  originalValue: string;
  temporaryValue: string;
}

interface PermitEvent {
  id: string;
  type: PermitEventType;
  author: string;
  role: string;
  note: string;
  at: string;
}

interface DeviationPermit {
  id: string;
  code: string;
  stepId: string;
  stepTitle: string;
  fields: PermitFieldChange[];
  reason: string;
  controls: string;
  effectiveFrom: string;
  effectiveUntil: string;
  status: PermitStatus;
  applicant: string;
  reviewer?: string;
  reviewNote?: string;
  appliedAt?: string;
  invalidatedAt?: string;
  invalidatedReason?: string;
  downstreamStepIds: string[];
  restored: boolean;
  events: PermitEvent[];
  createdAt: string;
}

interface ProcessStep {
  id: string;
  title: string;
  purpose: string;
  materials: string;
  equipment: string;
  amount: string;
  duration: number;
  hazards: string[];
  controls: string;
  dependencies: string[];
  safetyNote: string;
  expectedResult: string;
  status: StepStatus;
  comments: ReviewComment[];
  invalidatedByPermitIds?: string[];
}

interface VersionSnapshot {
  id: string;
  label: string;
  version: string;
  createdAt: string;
  note: string;
  author: string;
  steps: ProcessStep[];
  permits?: DeviationPermit[];
}

interface ExperimentProcess {
  id: string;
  title: string;
  code: string;
  objective: string;
  principal: string;
  lab: string;
  status: ProcessStatus;
  version: string;
  steps: ProcessStep[];
  versions: VersionSnapshot[];
  permits: DeviationPermit[];
  frozenAt?: string;
  updatedAt: string;
}

interface HistoryState {
  past: ExperimentProcess[];
  present: ExperimentProcess;
  future: ExperimentProcess[];
}

interface DiffItem {
  id: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  detail: string;
}

const STORAGE_KEY = 'sologsb-1027-lab-safety-v1';
const CURRENT_AUTHOR = '周宁';
const CURRENT_ROLE = '安全复核员';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const DEVIATION_FIELDS: { key: DeviationFieldKey; label: string }[] = [
  { key: 'materials', label: '材料' },
  { key: 'amount', label: '用量 / 参数' },
  { key: 'equipment', label: '设备' },
  { key: 'duration', label: '预计时间' },
  { key: 'controls', label: '控制措施' },
  { key: 'safetyNote', label: '安全说明' },
  { key: 'hazards', label: '危险项' },
  { key: 'expectedResult', label: '预期结果' },
  { key: 'purpose', label: '操作目的' },
  { key: 'title', label: '步骤名称' }
];
const DEVIATION_FIELD_LABELS: Record<DeviationFieldKey, string> = Object.fromEntries(
  DEVIATION_FIELDS.map((item) => [item.key, item.label])
) as Record<DeviationFieldKey, string>;
const RESEARCHER_AUTHOR = '李明';
const RESEARCHER_ROLE = '研究员';
const PERMIT_APPROVER = CURRENT_AUTHOR;

function fieldLabel(field: DeviationFieldKey): string {
  return DEVIATION_FIELD_LABELS[field];
}

function readStepField(step: ProcessStep, field: DeviationFieldKey): string {
  if (field === 'hazards') return step.hazards.join('，');
  if (field === 'duration') return String(step.duration);
  return step[field];
}

function writeStepField(step: ProcessStep, field: DeviationFieldKey, raw: string): void {
  if (field === 'hazards') {
    step.hazards = splitList(raw);
    return;
  }
  if (field === 'duration') {
    step.duration = Number(raw) || 0;
    return;
  }
  (step as unknown as Record<string, string>)[field] = raw;
}

function permitStatusLabel(status: PermitStatus): string {
  switch (status) {
    case 'pending': return '待审';
    case 'approved': return '已批准待生效';
    case 'rejected': return '未通过';
    case 'active': return '生效中';
    case 'expired': return '已到期';
    case 'revoked': return '已撤销';
    case 'drifted': return '字段已变化';
  }
}

function permitStatusIntent(status: PermitStatus): 'danger' | 'warning' | 'success' | 'primary' | 'none' {
  switch (status) {
    case 'active': return 'success';
    case 'pending': return 'warning';
    case 'approved': return 'primary';
    default: return 'danger';
  }
}

function permitEventLabel(type: PermitEventType): string {
  switch (type) {
    case 'created': return '提交申请';
    case 'withdrawn': return '撤回申请';
    case 'approved': return '复核人批准';
    case 'rejected': return '复核人驳回';
    case 'activated': return '临时值已套用并生效';
    case 'expired': return '许可到期';
    case 'revoked': return '许可撤销';
    case 'drifted': return '字段被改动，许可失效';
    case 'restored': return '已恢复原值';
    case 'cascade-invalidated': return '级联失效：下游已确认内容打回';
  }
}

/** 已失去效力的终态（到期、撤销、字段漂移、驳回），步骤确认被阻止、原确认立即失效。 */
function isPermitDead(status: PermitStatus): boolean {
  return status === 'expired' || status === 'revoked' || status === 'drifted' || status === 'rejected';
}

/** 阻止步骤确认的许可状态：待审、已驳回，或任何已失效但尚未恢复原值的许可。 */
function isPermitBlocking(permit: DeviationPermit): boolean {
  if (permit.status === 'pending') return true;
  if (isPermitDead(permit.status)) return !permit.restored;
  return false;
}

/** 待审 / 未通过 / 已过期时步骤不能确认；已失效但恢复原值后放行（仍需重新复核）。 */
function blockingPermitsForStep(permits: DeviationPermit[], stepId: string): DeviationPermit[] {
  return permits.filter((permit) => permit.stepId === stepId && isPermitBlocking(permit));
}

function activePermitsForStep(permits: DeviationPermit[], stepId: string): DeviationPermit[] {
  return permits.filter((permit) => permit.stepId === stepId && permit.status === 'active');
}

function hasBlockingPermit(permits: DeviationPermit[], stepId: string): boolean {
  return blockingPermitsForStep(permits, stepId).length > 0;
}

/** 许可生效中且已套用临时值时，对应字段锁定，研究员不能直接改。 */
function isFieldLocked(permits: DeviationPermit[], stepId: string, field: DeviationFieldKey): boolean {
  return activePermitsForStep(permits, stepId).some((permit) => permit.fields.some((change) => change.field === field));
}

function formatDateTimeInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatWindow(permit: DeviationPermit): string {
  return `${formatDate(permit.effectiveFrom)} – ${formatDate(permit.effectiveUntil)}`;
}

function makePermitEvent(type: PermitEventType, author: string, role: string, note: string): PermitEvent {
  return { id: uid('pevent'), type, author, role, note, at: new Date().toISOString() };
}

function nextPermitCode(permits: DeviationPermit[]): string {
  const year = new Date().getFullYear();
  const sequence = permits.length + 1;
  return `DEV-${year}-${String(sequence).padStart(3, '0')}`;
}

/** 许可失效（到期/撤销/字段漂移）时：目标步骤原确认立即失效，下游已确认步骤一并打回重新复核。 */
function invalidateChain(draft: ExperimentProcess, permit: DeviationPermit, type: PermitEventType, note: string): void {
  const now = new Date().toISOString();
  permit.status = type === 'expired' ? 'expired' : type === 'revoked' ? 'revoked' : 'drifted';
  permit.invalidatedAt = now;
  permit.invalidatedReason = note;
  permit.events.push(makePermitEvent(type, SYSTEM_ACTOR, SYSTEM_ROLE, note));
  const affectedIds = new Set<string>([permit.stepId, ...permit.downstreamStepIds]);
  affectedIds.forEach((stepId) => {
    const step = draft.steps.find((item) => item.id === stepId);
    if (!step) return;
    const markers = new Set(step.invalidatedByPermitIds ?? []);
    markers.add(permit.id);
    step.invalidatedByPermitIds = [...markers];
    if (step.status === 'confirmed') step.status = 'returned';
  });
  permit.events.push(makePermitEvent(
    'cascade-invalidated',
    SYSTEM_ACTOR,
    SYSTEM_ROLE,
    `目标步骤与 ${permit.downstreamStepIds.length} 个下游步骤的原确认立即失效，需复核人重新确认后方可恢复。`
  ));
}

const SYSTEM_ACTOR = '系统';
const SYSTEM_ROLE = '偏离许可规则';

function initialProcess(): ExperimentProcess {
  const baseSteps: ProcessStep[] = [
    {
      id: 'step-1', title: '核对试剂与实验区域', purpose: '确认所需物料、设备及区域状态符合实验方案。',
      materials: '无水乙醇、去离子水', equipment: '通风柜、防爆柜、标签打印机', amount: '乙醇 120 mL；去离子水 300 mL',
      duration: 15, hazards: ['易燃液体'], controls: '在通风柜内取用，远离点火源；使用接地金属容器。',
      dependencies: [], safetyNote: '操作人员需佩戴护目镜和防化手套。', expectedResult: '试剂标签、数量和有效期均核对无误。',
      status: 'confirmed', comments: [
        { id: 'c-1', author: '李明', role: '研究员', text: '已核对批号和有效期，防爆柜温度记录正常。', createdAt: '2026-09-24T09:10:00+08:00', resolved: true }
      ]
    },
    {
      id: 'step-2', title: '搭建恒温循环装置', purpose: '连接循环浴与反应夹套，检查密封和温控。',
      materials: '无', equipment: '恒温循环浴、硅胶管、反应夹套、扎带', amount: '循环液 800 mL',
      duration: 25, hazards: ['烫伤', '管路脱落'], controls: '管路双端固定；升温前完成 5 分钟试压并设置独立超温断电。',
      dependencies: ['step-1'], safetyNote: '高温表面设置警示标识，循环浴周围保持干燥。', expectedResult: '30 分钟内温度稳定在 55 ± 0.5 ℃。',
      status: 'confirmed', comments: [
        { id: 'c-2', author: '王颖', role: '安全复核员', text: '补充超温断电值，不能只依赖设备自带温控。', createdAt: '2026-09-24T10:05:00+08:00', resolved: true }
      ]
    },
    {
      id: 'step-3', title: '加入催化剂并启动反应', purpose: '按批次加入催化剂，记录起点并开始计时。',
      materials: '催化剂 A', equipment: '分析天平、加料漏斗、计时器', amount: '催化剂 A 2.50 ± 0.02 g',
      duration: 20, hazards: ['粉尘吸入', '放热反应'], controls: '在通风柜内称量，佩戴 N95 口罩；分三次少量加入并监测温度。',
      dependencies: ['step-2'], safetyNote: '反应温度超过 70 ℃ 时立即停止加料并启动冷却。', expectedResult: '温度缓慢升至 62–66 ℃，无明显冲料。',
      status: 'submitted', comments: []
    },
    {
      id: 'step-4', title: '恒温反应与过程取样', purpose: '维持温度并定时取样观察反应转化。',
      materials: '样品瓶、惰性气体', equipment: '取样针、气相色谱、恒温循环浴', amount: '每点样品约 1 mL，共 6 点',
      duration: 90, hazards: ['高温液体', '挥发性气体'], controls: '取样前泄压；使用长针和防护屏；样品瓶及时封闭。',
      dependencies: ['step-3'], safetyNote: '取样时不得正对瓶口，样品瓶不得完全密封后加热。', expectedResult: '转化率达到 95% 以上且无异常副产物。',
      status: 'submitted', comments: []
    },
    {
      id: 'step-5', title: '停止加热并冷却', purpose: '终止反应并将体系降至安全温度。',
      materials: '无', equipment: '循环浴、温度探头', amount: '降温目标 ≤ 30 ℃', duration: 35,
      hazards: ['烫伤', '残余反应'], controls: '先停止加料并维持搅拌，再以不超过 1 ℃/min 的速率降温。',
      dependencies: ['step-4'], safetyNote: '确认温度连续 5 分钟低于 30 ℃ 后才能拆除装置。', expectedResult: '体系温度稳定低于 30 ℃。',
      status: 'draft', comments: []
    },
    {
      id: 'step-6', title: '废液分类与现场恢复', purpose: '按危险废物要求分类收集并恢复实验区域。',
      materials: '废液桶、吸附棉', equipment: '防化手套、护目镜、危废标签', amount: '按实际产生量记录', duration: 25,
      hazards: ['废液混装', '化学暴露'], controls: '有机废液单独收集，核对相容性后贴标签；泄漏吸附材料按危废处置。',
      dependencies: ['step-5'], safetyNote: '废液不得倒入下水道，现场恢复后完成双人确认。', expectedResult: '废液交接记录完整，台面无残留。',
      status: 'draft', comments: []
    }
  ];

  const firstVersion: VersionSnapshot = {
    id: 'version-1-0', label: '首版批准流程', version: '1.0.0', createdAt: '2026-09-20T14:30:00+08:00',
    note: '建立基础反应与取样步骤。', author: '王颖',
    steps: clone(baseSteps).slice(0, 4).map((step) => ({ ...step, status: 'confirmed', comments: [] }))
  };
  const secondVersion: VersionSnapshot = {
    id: 'version-1-1', label: '补充冷却与废液步骤', version: '1.1.0', createdAt: '2026-09-24T15:10:00+08:00',
    note: '增加安全冷却、废液处置和现场恢复。', author: '王颖',
    steps: clone(baseSteps).map((step) => ({ ...step, status: 'confirmed', comments: [] }))
  };

  // 示例一：待审许可——研究员申请临时替换催化剂供应商批次，步骤尚未确认。
  const pendingPermit: DeviationPermit = {
    id: 'permit-demo-pending',
    code: 'DEV-2026-001',
    stepId: 'step-3',
    stepTitle: '加入催化剂并启动反应',
    fields: [
      { field: 'materials', originalValue: '催化剂 A', temporaryValue: '催化剂 A（备用批号 B-2260，粒度更细）' },
      { field: 'amount', originalValue: '催化剂 A 2.50 ± 0.02 g', temporaryValue: '催化剂 A 2.30 ± 0.02 g（细粒度等效投料）' }
    ],
    reason: '原批号库存余量不足，领用处临时调拨同型号备用批号；粒度由 40 目变为 60 目，需微调投料量。',
    controls: '通风柜内称量并佩戴 N95；先按 0.5 g 试投观察温升，确认无冲料后再分两次补齐；全程记录温度曲线。',
    effectiveFrom: '2026-09-28T20:00:00+08:00',
    effectiveUntil: '2026-09-29T08:00:00+08:00',
    status: 'pending',
    applicant: RESEARCHER_AUTHOR,
    downstreamStepIds: ['step-4', 'step-5', 'step-6'],
    restored: false,
    events: [
      {
        id: 'pevent-demo-pending', type: 'created', author: RESEARCHER_AUTHOR, role: RESEARCHER_ROLE,
        note: '实验中途临时换批号，待复核人批准后方可按临时值执行。', at: '2026-09-28T16:05:00+08:00'
      }
    ],
    createdAt: '2026-09-28T16:05:00+08:00'
  };

  // 示例二：已到期失效许可——原值已恢复，供查看完整批准依据与事件轨迹。
  const expiredPermit: DeviationPermit = {
    id: 'permit-demo-expired',
    code: 'DEV-2026-000',
    stepId: 'step-5',
    stepTitle: '停止加热并冷却',
    fields: [
      { field: 'duration', originalValue: '35', temporaryValue: '45' }
    ],
    reason: '9 月 26 日循环浴降温效率下降，需延长降温时长保证体系降至 30 ℃ 以下。',
    controls: '维持搅拌，降温速率仍不得超过 1 ℃/min；每 5 分钟记录一次温度。',
    effectiveFrom: '2026-09-26T14:00:00+08:00',
    effectiveUntil: '2026-09-26T22:00:00+08:00',
    status: 'expired',
    applicant: RESEARCHER_AUTHOR,
    reviewer: '王颖',
    reviewNote: '同意仅限当日批次，到期后恢复原 35 分钟设定。',
    appliedAt: '2026-09-26T14:00:00+08:00',
    invalidatedAt: '2026-09-26T22:00:00+08:00',
    invalidatedReason: '生效时段结束，许可自动到期。',
    downstreamStepIds: ['step-6'],
    restored: true,
    events: [
      { id: 'pevent-e1', type: 'created', author: RESEARCHER_AUTHOR, role: RESEARCHER_ROLE, note: '申请延长当日批次降温时间。', at: '2026-09-26T13:40:00+08:00' },
      { id: 'pevent-e2', type: 'approved', author: '王颖', role: CURRENT_ROLE, note: '同意仅限当日批次，到期后恢复原 35 分钟设定。', at: '2026-09-26T13:50:00+08:00' },
      { id: 'pevent-e3', type: 'activated', author: SYSTEM_ACTOR, role: SYSTEM_ROLE, note: '生效时间到达，临时值 45 分钟已套用。', at: '2026-09-26T14:00:00+08:00' },
      { id: 'pevent-e4', type: 'expired', author: SYSTEM_ACTOR, role: SYSTEM_ROLE, note: '生效时段结束，许可自动到期。', at: '2026-09-26T22:00:00+08:00' },
      { id: 'pevent-e5', type: 'restored', author: RESEARCHER_AUTHOR, role: RESEARCHER_ROLE, note: '已恢复原值 35 分钟。', at: '2026-09-26T22:08:00+08:00' }
    ],
    createdAt: '2026-09-26T13:40:00+08:00'
  };

  return {
    id: 'exp-catalyst-2026-09', title: '负载型催化剂评价实验', code: 'SAFE-CAT-026',
    objective: '在受控温度下评价催化剂活性，并完整记录过程样品与安全控制措施。',
    principal: '李明', lab: '材料化学实验室 B-207',
    status: 'in-review', version: '1.2.0-draft',
    steps: baseSteps, versions: [firstVersion, secondVersion],
    permits: [expiredPermit, pendingPermit],
    updatedAt: new Date().toISOString()
  };
}

function historyReducer(state: HistoryState, action:
  | { type: 'commit'; update: (draft: ExperimentProcess) => void }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: ExperimentProcess }
  | { type: 'enforce'; update: (draft: ExperimentProcess) => void }
): HistoryState {
  if (action.type === 'commit') {
    const next = clone(state.present);
    action.update(next);
    next.updatedAt = new Date().toISOString();
    return { past: [...state.past.slice(-59), clone(state.present)], present: next, future: [] };
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return { past: state.past.slice(0, -1), present: previous, future: [clone(state.present), ...state.future].slice(0, 60) };
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) return state;
    return { past: [...state.past, clone(state.present)].slice(-60), present: next, future: state.future.slice(1) };
  }
  if (action.type === 'enforce') {
    const next = clone(state.present);
    action.update(next);
    next.updatedAt = new Date().toISOString();
    return { ...state, present: next };
  }
  return { past: [], present: action.value, future: [] };
}

/**
 * 许可规则自动执行：
 * 1. 已批准且到生效时间 → 套用临时值转“生效中”；
 * 2. 生效中且到失效时间 → 到期，原确认立即失效并级联打回下游；
 * 3. 生效中的被改字段当前值与临时值不一致 → 判为字段漂移，许可立即失效；
 * 4. 已驳回但临时值已被套用（历史数据）→ 保持阻断，等待恢复原值。
 * 返回是否发生了自动迁移，供调用方决定保存提示。
 */
function enforcePermits(draft: ExperimentProcess, now: Date = new Date()): boolean {
  let changed = false;
  draft.permits.forEach((permit) => {
    const step = draft.steps.find((item) => item.id === permit.stepId);
    if (!step) return;
    if (permit.status === 'approved' && new Date(permit.effectiveFrom) <= now) {
      permit.fields.forEach((change) => writeStepField(step, change.field, change.temporaryValue));
      permit.status = 'active';
      permit.appliedAt = now.toISOString();
      permit.events.push(makePermitEvent('activated', SYSTEM_ACTOR, SYSTEM_ROLE, '生效时间到达，临时值已套用到步骤，字段在许可期间锁定。'));
      changed = true;
    }
    if (permit.status === 'active' && new Date(permit.effectiveUntil) <= now) {
      invalidateChain(draft, permit, 'expired', '生效时段结束，许可自动到期，步骤在恢复原值并重新复核前不得确认。');
      changed = true;
      return;
    }
    if (permit.status === 'active') {
      const driftedField = permit.fields.find((change) => readStepField(step, change.field) !== change.temporaryValue);
      if (driftedField) {
        invalidateChain(draft, permit, 'drifted', `字段「${fieldLabel(driftedField.field)}」在许可期间被改动，与批准的临时值不一致，许可立即失效。`);
        changed = true;
      }
    }
  });
  return changed;
}

function normalizeProcess(value: ExperimentProcess): ExperimentProcess {
  const draft = clone(value);
  if (!Array.isArray(draft.permits)) draft.permits = [];
  draft.steps.forEach((step) => {
    if (!Array.isArray(step.comments)) step.comments = [];
    if (!Array.isArray(step.dependencies)) step.dependencies = [];
    if (!Array.isArray(step.hazards)) step.hazards = [];
  });
  enforcePermits(draft);
  return draft;
}

function loadProcess(): ExperimentProcess {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return normalizeProcess(initialProcess());
    const parsed = JSON.parse(value) as ExperimentProcess;
    if (!parsed.id || !Array.isArray(parsed.steps)) return normalizeProcess(initialProcess());
    return normalizeProcess(parsed);
  } catch {
    return normalizeProcess(initialProcess());
  }
}

function splitList(value: string): string[] {
  return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

function statusLabel(status: StepStatus): string {
  return status === 'confirmed' ? '已确认' : status === 'returned' ? '已退回' : status === 'submitted' ? '待复核' : '草稿';
}

function processStatusLabel(status: ProcessStatus): string {
  return status === 'frozen' ? '已冻结' : status === 'in-review' ? '复核中' : status === 'revising' ? '修订中' : '草稿';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({ past: [], present: loadProcess(), future: [] }));
  const process = history.present;
  const [selectedStepId, setSelectedStepId] = useState(process.steps[0]?.id ?? '');
  const [activeView, setActiveView] = useState<ViewId>('editor');
  const [lastModifiedId, setLastModifiedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [savedLabel, setSavedLabel] = useState('本地数据已载入');
  const [online, setOnline] = useState(true);
  const [compareBaseId, setCompareBaseId] = useState(process.versions[0]?.id ?? '');
  const [compareTargetId, setCompareTargetId] = useState(process.versions.at(-1)?.id ?? '');
  const [showPermitForm, setShowPermitForm] = useState(false);
  const [permitStepId, setPermitStepId] = useState(selectedStepId);
  const [permitFieldKeys, setPermitFieldKeys] = useState<DeviationFieldKey[]>(['materials']);
  const [permitTempValues, setPermitTempValues] = useState<Partial<Record<DeviationFieldKey, string>>>({});
  const [permitReason, setPermitReason] = useState('');
  const [permitControls, setPermitControls] = useState('');
  const [permitFrom, setPermitFrom] = useState(formatDateTimeInputValue(new Date().toISOString()).slice(0, 16));
  const [permitUntil, setPermitUntil] = useState(formatDateTimeInputValue(new Date(Date.now() + 8 * 3600_000).toISOString()).slice(0, 16));
  const [reviewNote, setReviewNote] = useState('');
  const initialSaveSkipped = useRef(false);

  const selectedStep = process.steps.find((step) => step.id === selectedStepId) ?? process.steps[0];
  const downstreamIds = useMemo(() => collectDownstream(process.steps, lastModifiedId), [process.steps, lastModifiedId]);
  const impactedSteps = process.steps.filter((step) => downstreamIds.includes(step.id));
  const missingSafetySteps = process.steps.filter(hasMissingSafety);
  const pendingReviewCount = process.steps.filter((step) => step.status === 'submitted' || step.status === 'returned').length;
  const confirmedCount = process.steps.filter((step) => step.status === 'confirmed').length;
  const reviewProgress = process.steps.length ? Math.round((confirmedCount / process.steps.length) * 100) : 0;
  const versionDiff = useMemo(() => compareVersions(process, compareBaseId, compareTargetId), [process, compareBaseId, compareTargetId]);
  const pendingPermitCount = process.permits.filter((permit) => permit.status === 'pending').length;
  const blockingStepCount = process.steps.filter((step) => hasBlockingPermit(process.permits, step.id)).length;

  useEffect(() => {
    if (!initialSaveSkipped.current) {
      initialSaveSkipped.current = true;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(process));
    setSavedLabel(`自动保存 · ${formatDate(new Date().toISOString())}`);
  }, [process]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // 每 30 秒跑一次许可规则：到点生效、到期失效、字段漂移检测，重开页面后也会立即执行一次。
  useEffect(() => {
    const tick = (): void => {
      dispatch({
        type: 'enforce',
        update: (draft) => {
          if (enforcePermits(draft)) setSavedLabel('偏离许可状态已按生效时段自动更新');
        }
      });
    };
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? dispatch({ type: 'redo' }) : dispatch({ type: 'undo' });
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(process));
        setSavedLabel(`手动保存 · ${formatDate(new Date().toISOString())}`);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [process]);

  const commitProcess = (update: (draft: ExperimentProcess) => void): void => {
    dispatch({ type: 'commit', update });
  };

  const updateProcessField = (field: 'title' | 'code' | 'objective' | 'principal' | 'lab', value: string): void => {
    commitProcess((draft) => { draft[field] = value; });
  };

  const updateStep = (field: keyof ProcessStep, value: unknown): void => {
    if (!selectedStep) return;
    const id = selectedStep.id;
    const deviationField = DEVIATION_FIELDS.some((item) => item.key === field) ? field as DeviationFieldKey : null;
    // 生效中的许可锁定被改字段：必须等许可到期/撤销并恢复原值后才能直接编辑。
    if (deviationField && isFieldLocked(process.permits, id, deviationField)) {
      setSavedLabel('该字段处于偏离许可生效期内，已锁定');
      return;
    }
    setLastModifiedId(id);
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      if (!step) return;
      (step as unknown as Record<string, unknown>)[field] = value;
      if (!deviationField) return;
      // 待审许可引用的字段一旦被改动，申请依据立即作废（尚未套用临时值，无需恢复），需要重新提交申请。
      draft.permits
        .filter((permit) => permit.stepId === id && permit.status === 'pending' && permit.fields.some((change) => change.field === deviationField))
        .forEach((permit) => {
          permit.status = 'revoked';
          permit.restored = true;
          permit.invalidatedAt = new Date().toISOString();
          permit.invalidatedReason = `申请待审期间字段「${fieldLabel(deviationField)}」原值已变化，申请依据自动作废，请重新提交。`;
          permit.events.push(makePermitEvent('revoked', RESEARCHER_AUTHOR, RESEARCHER_ROLE, permit.invalidatedReason ?? ''));
        });
    });
  };

  const updateStepList = (field: 'hazards' | 'dependencies', value: string): void => {
    updateStep(field, splitList(value));
  };

  const addStep = (): void => {
    if (process.status === 'frozen') return;
    const id = uid('step');
    commitProcess((draft) => {
      draft.steps.push({
        id, title: '新的实验步骤', purpose: '', materials: '', equipment: '', amount: '', duration: 10,
        hazards: [], controls: '', dependencies: draft.steps.at(-1) ? [draft.steps.at(-1)!.id] : [],
        safetyNote: '', expectedResult: '', status: 'draft', comments: []
      });
      draft.status = 'draft';
    });
    setSelectedStepId(id);
    setLastModifiedId(id);
    setActiveView('editor');
  };

  const duplicateStep = (): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const copy: ProcessStep = clone(selectedStep);
    copy.id = uid('step');
    copy.title = `${copy.title}（副本）`;
    copy.status = 'draft';
    copy.comments = [];
    copy.dependencies = [...copy.dependencies];
    commitProcess((draft) => {
      const index = draft.steps.findIndex((step) => step.id === selectedStep.id);
      draft.steps.splice(index + 1, 0, copy);
    });
    setSelectedStepId(copy.id);
  };

  const deleteStep = (): void => {
    if (!selectedStep || process.steps.length <= 1 || process.status === 'frozen') return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      draft.steps = draft.steps.filter((step) => step.id !== id);
      draft.steps.forEach((step) => { step.dependencies = step.dependencies.filter((dependency) => dependency !== id); });
      // 步骤被删除：关闭其名下未结许可并记录原因，避免悬挂许可永久阻止确认与冻结。
      draft.permits
        .filter((permit) => permit.stepId === id && ['pending', 'approved', 'active'].includes(permit.status))
        .forEach((permit) => {
          permit.status = 'revoked';
          permit.restored = true;
          permit.invalidatedAt = new Date().toISOString();
          permit.invalidatedReason = '目标步骤已从流程中删除，许可自动关闭。';
          permit.events.push(makePermitEvent('revoked', RESEARCHER_AUTHOR, RESEARCHER_ROLE, permit.invalidatedReason));
        });
    });
    setSelectedStepId(process.steps.find((step) => step.id !== id)?.id ?? '');
  };

  const moveStep = (direction: -1 | 1): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      const index = draft.steps.findIndex((step) => step.id === id);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
      const [step] = draft.steps.splice(index, 1);
      draft.steps.splice(nextIndex, 0, step);
    });
    setLastModifiedId(id);
  };

  const toggleDependency = (dependencyId: string, checked: boolean): void => {
    if (!selectedStep) return;
    const next = checked
      ? [...new Set([...selectedStep.dependencies, dependencyId])]
      : selectedStep.dependencies.filter((id) => id !== dependencyId);
    updateStep('dependencies', next);
  };

  const submitForReview = (): void => {
    if (process.status === 'frozen') return;
    commitProcess((draft) => {
      draft.status = 'in-review';
      draft.steps.forEach((step) => {
        if (step.status !== 'confirmed') step.status = 'submitted';
      });
    });
    setActiveView('review');
    setSavedLabel('流程已提交复核');
  };

  const addReviewComment = (): void => {
    if (!selectedStep || !commentText.trim()) return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      step?.comments.push({
        id: uid('comment'), author: CURRENT_AUTHOR, role: CURRENT_ROLE,
        text: commentText.trim(), createdAt: new Date().toISOString(), resolved: false
      });
    });
    setCommentText('');
  };

  const setStepStatus = (status: StepStatus): void => {
    if (!selectedStep) return;
    updateStep('status', status);
    setLastModifiedId(status === 'returned' ? selectedStep.id : null);
  };

  const resolveComment = (commentId: string): void => {
    if (!selectedStep) return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const comment = draft.steps.find((step) => step.id === stepId)?.comments.find((item) => item.id === commentId);
      if (comment) comment.resolved = !comment.resolved;
    });
  };

  const openPermitForm = (stepId: string): void => {
    const step = process.steps.find((item) => item.id === stepId);
    if (!step) return;
    setPermitStepId(stepId);
    setPermitFieldKeys(['materials']);
    const defaults: Partial<Record<DeviationFieldKey, string>> = {};
    DEVIATION_FIELDS.forEach(({ key }) => { defaults[key] = readStepField(step, key); });
    setPermitTempValues(defaults);
    setPermitReason('');
    setPermitControls(step.controls);
    setPermitFrom(formatDateTimeInputValue(new Date().toISOString()).slice(0, 16));
    setPermitUntil(formatDateTimeInputValue(new Date(Date.now() + 8 * 3600_000).toISOString()).slice(0, 16));
    setShowPermitForm(true);
  };

  const togglePermitField = (field: DeviationFieldKey, checked: boolean): void => {
    setPermitFieldKeys((current) => {
      if (checked) return [...current, field];
      const next = current.filter((key) => key !== field);
      return next.length ? next : current;
    });
  };

  const submitPermit = (): void => {
    const step = process.steps.find((item) => item.id === permitStepId);
    if (!step) return;
    const changes: PermitFieldChange[] = permitFieldKeys.map((field) => ({
      field,
      originalValue: readStepField(step, field),
      temporaryValue: (permitTempValues[field] ?? '').trim()
    }));    const effectiveFrom = new Date(permitFrom).toISOString();
    const effectiveUntil = new Date(permitUntil).toISOString();
    if (
      !changes.length ||
      !permitReason.trim() ||
      !permitControls.trim() ||
      Number.isNaN(new Date(effectiveFrom).getTime()) ||
      Number.isNaN(new Date(effectiveUntil).getTime()) ||
      new Date(effectiveUntil) <= new Date(effectiveFrom) ||
      changes.some((change) => !change.temporaryValue)
    ) {
      setSavedLabel('请补全字段临时值、原因、控制措施和有效的生效时段');
      return;
    }
    const downstream = collectDownstream(process.steps, step.id);
    const permit: DeviationPermit = {
      id: uid('permit'),
      code: nextPermitCode(process.permits),
      stepId: step.id,
      stepTitle: step.title,
      fields: changes,
      reason: permitReason.trim(),
      controls: permitControls.trim(),
      effectiveFrom,
      effectiveUntil,
      status: 'pending',
      applicant: RESEARCHER_AUTHOR,
      downstreamStepIds: downstream,
      restored: false,
      events: [makePermitEvent('created', RESEARCHER_AUTHOR, RESEARCHER_ROLE, '提交偏离许可申请，待复核人审批。')],
      createdAt: new Date().toISOString()
    };
    commitProcess((draft) => {
      // 同一步骤已有待审申请时直接作废旧申请，避免两张待审许可并存。
      draft.permits
        .filter((item) => item.stepId === step.id && item.status === 'pending')
        .forEach((item) => {
          item.status = 'revoked';
          item.restored = true; // 待审申请从未套用临时值，作废即视为无残留
          item.invalidatedAt = new Date().toISOString();
          item.invalidatedReason = '同一步骤重新提交申请，旧待审申请自动作废。';
          item.events.push(makePermitEvent('revoked', RESEARCHER_AUTHOR, RESEARCHER_ROLE, item.invalidatedReason ?? ''));
        });
      draft.permits.push(permit);
    });
    setShowPermitForm(false);
    setSavedLabel('偏离许可已提交，待复核人审批');
    setActiveView('permits');
  };

  const withdrawPermit = (permitId: string): void => {
    commitProcess((draft) => {
      const permit = draft.permits.find((item) => item.id === permitId);
      if (!permit || permit.status !== 'pending') return;
      permit.status = 'rejected';
      permit.restored = true; // 待审阶段撤回，步骤原值从未改动
      permit.invalidatedAt = new Date().toISOString();
      permit.invalidatedReason = '研究员在审批前撤回申请。';
      permit.events.push(makePermitEvent('withdrawn', RESEARCHER_AUTHOR, RESEARCHER_ROLE, '审批前撤回申请。'));
    });
    setSavedLabel('偏离许可申请已撤回');
  };

  const decidePermit = (permitId: string, approved: boolean): void => {
    const note = reviewNote.trim() || (approved ? '同意按临时值执行，到期自动失效。' : '不同意本次偏离，请恢复原方案后再提交。');
    commitProcess((draft) => {
      const permit = draft.permits.find((item) => item.id === permitId);
      if (!permit || permit.status !== 'pending') return;
      permit.reviewer = PERMIT_APPROVER;
      permit.reviewNote = note;
      const now = new Date();
      if (!approved) {
        permit.status = 'rejected';
        permit.invalidatedAt = now.toISOString();
        permit.invalidatedReason = '复核人未通过申请。';
        permit.events.push(makePermitEvent('rejected', PERMIT_APPROVER, CURRENT_ROLE, note));
        // 未通过时目标步骤不能确认；若已有确认则立即失效。
        const target = draft.steps.find((step) => step.id === permit.stepId);
        if (target) {
          target.invalidatedByPermitIds = [...new Set([...(target.invalidatedByPermitIds ?? []), permit.id])];
          if (target.status === 'confirmed') target.status = 'returned';
        }
        setSavedLabel('已驳回偏离许可，目标步骤不能确认');
        return;
      }
      if (new Date(permit.effectiveUntil) <= now) {
        permit.status = 'rejected';
        permit.invalidatedAt = now.toISOString();
        permit.invalidatedReason = '审批时生效时段已过期，申请作废。';
        permit.events.push(makePermitEvent('rejected', PERMIT_APPROVER, CURRENT_ROLE, '审批时生效时段已过期，不能批准。'));
        setSavedLabel('生效时段已过，不能批准');
        return;
      }
      permit.events.push(makePermitEvent('approved', PERMIT_APPROVER, CURRENT_ROLE, note));
      // 批准时若已到生效时间则立即套用临时值，否则等待心跳到点套用。
      if (new Date(permit.effectiveFrom) <= now) {
        const target = draft.steps.find((step) => step.id === permit.stepId);
        if (target) {
          permit.fields.forEach((change) => writeStepField(target, change.field, change.temporaryValue));
          permit.status = 'active';
          permit.appliedAt = now.toISOString();
          permit.events.push(makePermitEvent('activated', SYSTEM_ACTOR, SYSTEM_ROLE, '批准时已到生效时间，临时值立即套用，字段锁定。'));
        }
      } else {
        permit.status = 'approved';
      }
      // 下游已确认步骤在临时方案执行期间必须重新复核，复核人同意后才恢复。
      permit.downstreamStepIds.forEach((stepId) => {
        const downstream = draft.steps.find((step) => step.id === stepId);
        if (downstream && downstream.status === 'confirmed') {
          downstream.status = 'returned';
          downstream.invalidatedByPermitIds = [...new Set([...(downstream.invalidatedByPermitIds ?? []), permit.id])];
        }
      });
      setSavedLabel('偏离许可已批准，下游已确认内容需重新复核');
    });
    setReviewNote('');
  };

  const revokePermit = (permitId: string): void => {
    commitProcess((draft) => {
      const permit = draft.permits.find((item) => item.id === permitId);
      if (!permit || (permit.status !== 'active' && permit.status !== 'approved')) return;
      invalidateChain(draft, permit, 'revoked', '复核人撤销许可，临时值立即停用，需恢复原值并重新复核。');
    });
    setSavedLabel('偏离许可已撤销，原确认立即失效');
  };

  const restorePermitValues = (permitId: string): void => {
    commitProcess((draft) => {
      const permit = draft.permits.find((item) => item.id === permitId);
      const step = permit && draft.steps.find((item) => item.id === permit.stepId);
      if (!permit || !step || !isPermitDead(permit.status) || permit.restored) return;
      permit.fields.forEach((change) => writeStepField(step, change.field, change.originalValue));
      permit.restored = true;
      step.invalidatedByPermitIds = (step.invalidatedByPermitIds ?? []).filter((id) => id !== permit.id);
      permit.events.push(makePermitEvent('restored', RESEARCHER_AUTHOR, RESEARCHER_ROLE, '已按记录恢复全部原值，等待复核人重新确认。'));
    });
    setSavedLabel('已恢复原值，请提交复核人重新确认');
  };

  const freezeVersion = (): void => {
    if (process.status === 'frozen') return;
    if (process.steps.some((step) => step.status !== 'confirmed') || missingSafetySteps.length) {
      setSavedLabel('冻结条件未满足');
      return;
    }
    if (process.permits.some((permit) => isPermitBlocking(permit) || permit.status === 'active' || permit.status === 'approved' || permit.status === 'pending')) {
      setSavedLabel('存在未关闭的偏离许可，不能冻结版本');
      return;
    }
    const nextNumber = nextMinorVersion(process.version);
    const previousVersionId = process.versions.at(-1)?.id ?? '';
    const frozenVersionId = uid('version');
    commitProcess((draft) => {
      draft.versions.push({
        id: frozenVersionId, label: '复核通过冻结版', version: nextNumber,
        createdAt: new Date().toISOString(), note: `${draft.steps.length} 个步骤全部确认，安全控制完整。`,
        author: CURRENT_AUTHOR, steps: clone(draft.steps), permits: clone(draft.permits)
      });
      draft.version = nextNumber;
      draft.status = 'frozen';
      draft.frozenAt = new Date().toISOString();
    });
    setSavedLabel(`版本 ${nextNumber} 已冻结`);
    setCompareBaseId(previousVersionId);
    setCompareTargetId(frozenVersionId);
  };

  const startRevision = (): void => {
    if (process.status !== 'frozen') return;
    commitProcess((draft) => {
      const nextNumber = nextMinorVersion(draft.version);
      draft.version = `${nextNumber}-revision`;
      draft.status = 'revising';
      draft.frozenAt = undefined;
      draft.steps.forEach((step) => {
        step.status = 'draft';
        step.comments = [];
      });
    });
    setActiveView('editor');
    setSavedLabel('已从冻结版本创建修订稿');
  };

  const addVersionSnapshot = (): void => {
    commitProcess((draft) => {
      draft.versions.push({
        id: uid('version'), label: '工作版本快照', version: draft.version.replace('-draft', ''),
        createdAt: new Date().toISOString(), note: '保存当前步骤、复核状态与全部偏离许可记录。',
        author: CURRENT_AUTHOR, steps: clone(draft.steps), permits: clone(draft.permits)
      });
    });
    setSavedLabel('已保存工作版本快照（含偏离许可记录）');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-icon"><Icon icon="lab-test" size={23} /></div>
          <div><h1>实验流程安全复核台</h1><p>步骤影响分析 · 逐条复核 · 冻结版本</p></div>
        </div>
        <div className="header-status">
          <span className={`network ${online ? 'online' : ''}`}></span>
          <span>{online ? '离线保存已启用' : '当前离线，修改仍会保存'}</span>
          <strong>{savedLabel}</strong>
        </div>
        <div className="header-actions">
          <Button icon="undo" text="撤销" minimal disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })} />
          <Button icon="redo" text="重做" minimal disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })} />
          <Button icon="floppy-disk" text="保存快照" onClick={addVersionSnapshot} />
          <Button icon="lock" text="冻结版本" intent="primary" onClick={freezeVersion} disabled={process.status === 'frozen'} />
        </div>
      </header>

      {!online && <Callout className="offline-callout" intent="warning" icon="cloud">网络不可用。编辑、复核和版本快照仍会保存在当前浏览器。</Callout>}

      <section className="process-banner">
        <div className="banner-main">
          <div className="code-line"><span>{process.code}</span><Tag minimal>{processStatusLabel(process.status)}</Tag></div>
          <h2>{process.title}</h2>
          <p>{process.objective}</p>
        </div>
        <div className="banner-meta">
          <div><span>负责人</span><strong>{process.principal}</strong></div>
          <div><span>实验区域</span><strong>{process.lab}</strong></div>
          <div><span>当前版本</span><strong>{process.version}</strong></div>
        </div>
        <div className="banner-progress">
          <div><span>复核进度</span><strong>{confirmedCount}/{process.steps.length}</strong></div>
          <ProgressBar value={reviewProgress / 100} intent={reviewProgress === 100 ? 'success' : 'primary'} stripes={reviewProgress < 100} />
          <small>{pendingReviewCount ? `${pendingReviewCount} 条待处理` : '所有步骤已处理'} · {missingSafetySteps.length} 条安全缺口</small>
        </div>
      </section>

      <Tabs id="workspace-tabs" selectedTabId={activeView} onChange={(value) => setActiveView(value as ViewId)} renderActiveTabPanelOnly className="workspace-tabs">
        <Tab id="editor" title={<span><Icon icon="edit" /> 流程编写</span>} />
        <Tab id="review" title={<span><Icon icon="endorsed" /> 安全复核 {pendingReviewCount > 0 && <b className="tab-badge">{pendingReviewCount}</b>}</span>} />
        <Tab id="permits" title={<span><Icon icon="shield" /> 偏离许可 {pendingPermitCount > 0 && <b className="tab-badge">{pendingPermitCount}</b>}</span>} />
        <Tab id="compare" title={<span><Icon icon="comparison" /> 版本比较</span>} />
      </Tabs>

      {activeView === 'editor' && selectedStep && (
        <main className="editor-layout">
          <aside className="step-panel">
            <div className="panel-heading">
              <div><span>PROCESS STEPS</span><h3>实验步骤</h3></div>
              <Button icon="add" minimal small onClick={addStep} disabled={process.status === 'frozen'} />
            </div>
            <div className="step-list">
              {process.steps.map((step, index) => (
                <button key={step.id} className={step.id === selectedStep.id ? 'selected' : ''} onClick={() => setSelectedStepId(step.id)}>
                  <span className={`step-number ${step.status}`}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="step-copy"><strong>{step.title}</strong><small>{step.duration} 分钟 · {statusLabel(step.status)}</small></span>
                  {hasMissingSafety(step) && <Icon icon="warning-sign" intent="danger" size={13} />}
                </button>
              ))}
            </div>
            <div className="step-actions">
              <Button icon="arrow-up" small minimal disabled={process.steps[0]?.id === selectedStep.id || process.status === 'frozen'} onClick={() => moveStep(-1)} />
              <Button icon="arrow-down" small minimal disabled={process.steps.at(-1)?.id === selectedStep.id || process.status === 'frozen'} onClick={() => moveStep(1)} />
              <Button icon="duplicate" small minimal text="复制" disabled={process.status === 'frozen'} onClick={duplicateStep} />
              <Button icon="trash" small minimal intent="danger" disabled={process.status === 'frozen'} onClick={deleteStep} />
            </div>
          </aside>

          <section className="editor-main">
            <Card elevation={Elevation.ONE} className="process-meta-card">
              <div className="card-title"><div><span>PROCESS INFO</span><h3>实验基本信息</h3></div><Tag minimal intent="primary">{process.steps.length} 个步骤</Tag></div>
              <div className="meta-grid">
                <FormGroup label="实验名称" labelFor="process-title"><InputGroup id="process-title" fill value={process.title} onChange={(event) => updateProcessField('title', event.target.value)} /></FormGroup>
                <FormGroup label="流程编号" labelFor="process-code"><InputGroup id="process-code" fill value={process.code} onChange={(event) => updateProcessField('code', event.target.value)} /></FormGroup>
                <FormGroup label="负责人" labelFor="principal"><InputGroup id="principal" fill value={process.principal} onChange={(event) => updateProcessField('principal', event.target.value)} /></FormGroup>
                <FormGroup label="实验区域" labelFor="lab"><InputGroup id="lab" fill value={process.lab} onChange={(event) => updateProcessField('lab', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="实验目标" labelFor="objective"><TextArea id="objective" fill value={process.objective} onChange={(event) => updateProcessField('objective', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="step-editor-card">
              <div className="card-title">
                <div><span>STEP {String(process.steps.indexOf(selectedStep) + 1).padStart(2, '0')}</span><h3>{selectedStep.title}</h3></div>
                <div className="card-title-tags">
                  <Tag minimal intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag>
                  <Button small icon="shield" text="申请偏离许可" onClick={() => openPermitForm(selectedStep.id)} />
                </div>
              </div>
              <StepPermitNotice
                permits={process.permits}
                stepId={selectedStep.id}
                onRestore={restorePermitValues}
                onGotoPermits={() => setActiveView('permits')}
                onRevoke={revokePermit}
              />
              <FormGroup label="步骤名称" labelFor="step-title" helperText={lockedFieldHint(selectedStep.id, 'title', process.permits)}>
                <InputGroup id="step-title" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'title')} value={selectedStep.title} onChange={(event) => updateStep('title', event.target.value)} />
              </FormGroup>
              <FormGroup label="操作目的" labelFor="step-purpose" helperText={lockedFieldHint(selectedStep.id, 'purpose', process.permits)}>
                <TextArea id="step-purpose" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'purpose')} value={selectedStep.purpose} onChange={(event) => updateStep('purpose', event.target.value)} />
              </FormGroup>
              <div className="form-grid">
                <FormGroup label="材料" labelFor="materials" helperText={lockedFieldHint(selectedStep.id, 'materials', process.permits)}><TextArea id="materials" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'materials')} value={selectedStep.materials} onChange={(event) => updateStep('materials', event.target.value)} /></FormGroup>
                <FormGroup label="设备" labelFor="equipment" helperText={lockedFieldHint(selectedStep.id, 'equipment', process.permits)}><TextArea id="equipment" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'equipment')} value={selectedStep.equipment} onChange={(event) => updateStep('equipment', event.target.value)} /></FormGroup>
                <FormGroup label="用量 / 参数" labelFor="amount" helperText={lockedFieldHint(selectedStep.id, 'amount', process.permits)}><TextArea id="amount" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'amount')} value={selectedStep.amount} onChange={(event) => updateStep('amount', event.target.value)} /></FormGroup>
                <FormGroup label="预计时间（分钟）" labelFor="duration" helperText={lockedFieldHint(selectedStep.id, 'duration', process.permits)}><InputGroup id="duration" type="number" min={1} fill disabled={isFieldLocked(process.permits, selectedStep.id, 'duration')} value={String(selectedStep.duration)} onChange={(event) => updateStep('duration', Number(event.target.value))} /></FormGroup>
              </div>
              <div className="form-grid two-column">
                <FormGroup label="危险项（逗号或换行分隔）" labelFor="hazards" helperText={lockedFieldHint(selectedStep.id, 'hazards', process.permits)}><TextArea id="hazards" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'hazards')} value={selectedStep.hazards.join('，')} onChange={(event) => updateStepList('hazards', event.target.value)} /></FormGroup>
                <FormGroup label="控制措施" labelFor="controls" helperText={lockedFieldHint(selectedStep.id, 'controls', process.permits)}><TextArea id="controls" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'controls')} value={selectedStep.controls} onChange={(event) => updateStep('controls', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="安全说明" labelFor="safety-note" helperText={hasMissingSafety(selectedStep) ? '存在危险项时，控制措施和安全说明均为必填。' : lockedFieldHint(selectedStep.id, 'safetyNote', process.permits) || '安全说明已满足复核条件。'}>
                <TextArea id="safety-note" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'safetyNote')} intent={hasMissingSafety(selectedStep) ? 'danger' : 'none'} value={selectedStep.safetyNote} onChange={(event) => updateStep('safetyNote', event.target.value)} />
              </FormGroup>
              <FormGroup label="预期结果" labelFor="expected" helperText={lockedFieldHint(selectedStep.id, 'expectedResult', process.permits)}><TextArea id="expected" fill disabled={isFieldLocked(process.permits, selectedStep.id, 'expectedResult')} value={selectedStep.expectedResult} onChange={(event) => updateStep('expectedResult', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="dependency-card">
              <div className="card-title"><div><span>DEPENDENCIES</span><h3>前置步骤</h3></div><Tag minimal>{selectedStep.dependencies.length} 个依赖</Tag></div>
              <p className="muted">当前步骤只有在所选前置步骤完成后才能进入执行队列。</p>
              <div className="dependency-grid">
                {process.steps.filter((step) => step.id !== selectedStep.id).map((step) => (
                  <Checkbox key={step.id} checked={selectedStep.dependencies.includes(step.id)} label={`${String(process.steps.indexOf(step) + 1).padStart(2, '0')} · ${step.title}`} onChange={(event) => toggleDependency(step.id, event.currentTarget.checked)} />
                ))}
              </div>
            </Card>
          </section>

          <aside className="inspector-panel">
            <Card elevation={Elevation.ONE} className="impact-card">
              <div className="card-title"><div><span>IMPACT ANALYSIS</span><h3>变更影响提醒</h3></div><Icon icon="path-search" size={18} /></div>
              {lastModifiedId ? (
                <>
                  <Callout intent={impactedSteps.length ? 'warning' : 'primary'} icon={impactedSteps.length ? 'warning-sign' : 'tick'}>
                    <strong>{impactedSteps.length ? `${impactedSteps.length} 个后续步骤受影响` : '未发现下游步骤'}</strong>
                    <p>{impactedSteps.length ? '请重新核对依赖、用量、危险项和已确认内容。' : '当前修改没有影响其他步骤的安全条件。'}</p>
                  </Callout>
                  <div className="impact-list">
                    {impactedSteps.map((step) => (
                      <button key={step.id} onClick={() => setSelectedStepId(step.id)}>
                        <Icon icon={step.status === 'confirmed' ? 'endorsed' : 'circle'} intent={step.status === 'confirmed' ? 'success' : 'none'} size={13} />
                        <span><strong>{step.title}</strong><small>{step.status === 'confirmed' ? '已确认内容，需重新复核' : `当前状态：${statusLabel(step.status)}`}</small></span>
                        <Icon icon="chevron-right" size={12} />
                      </button>
                    ))}
                  </div>
                </>
              ) : <p className="muted">编辑任一步骤后，这里会显示受影响的所有后续步骤和已确认内容。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="safety-card">
              <div className="card-title"><div><span>SAFETY GATE</span><h3>安全完整性</h3></div><Tag intent={missingSafetySteps.length ? 'danger' : 'success'} minimal>{missingSafetySteps.length ? `${missingSafetySteps.length} 项缺口` : '通过'}</Tag></div>
              {missingSafetySteps.length ? missingSafetySteps.map((step) => (
                <button className="safety-row" key={step.id} onClick={() => setSelectedStepId(step.id)}><Icon icon="warning-sign" intent="danger" size={14} /><span><strong>{step.title}</strong><small>危险项缺少控制措施或安全说明</small></span></button>
              )) : <p className="muted">所有存在危险项的步骤都已填写控制措施和安全说明。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="gate-card">
              <div className="card-title"><div><span>RELEASE GATE</span><h3>提交与冻结</h3></div></div>
              <div className="gate-row"><span>复核状态</span><strong>{confirmedCount}/{process.steps.length}</strong></div>
              <div className="gate-row"><span>安全缺口</span><strong className={missingSafetySteps.length ? 'danger-text' : ''}>{missingSafetySteps.length}</strong></div>
              <div className="gate-row"><span>偏离许可阻断</span><strong className={blockingStepCount ? 'danger-text' : ''}>{blockingStepCount} 个步骤</strong></div>
              <div className="gate-row"><span>流程状态</span><strong>{processStatusLabel(process.status)}</strong></div>
              <Divider />
              {process.status === 'frozen' ? <Button fill intent="warning" icon="git-branch" text="从冻结版创建修订" onClick={startRevision} /> : <Button fill intent="primary" icon="send-to" text="提交复核" onClick={submitForReview} />}
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'review' && (
        <main className="review-layout">
          <aside className="review-steps">
            <div className="panel-heading"><div><span>REVIEW QUEUE</span><h3>逐条复核</h3></div><Tag intent={pendingReviewCount ? 'warning' : 'success'}>{pendingReviewCount ? `${pendingReviewCount} 待处理` : '已完成'}</Tag></div>
            {process.steps.map((step, index) => (
              <button key={step.id} className={`${step.id === selectedStep.id ? 'selected' : ''} ${step.status}`} onClick={() => setSelectedStepId(step.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{statusLabel(step.status)}</small></div><Icon icon={step.status === 'confirmed' ? 'tick-circle' : step.status === 'returned' ? 'undo' : 'circle'} size={15} />
              </button>
            ))}
          </aside>
          <section className="review-main">
            {selectedStep && (
              <>
                <Card elevation={Elevation.ONE} className="review-summary">
                  <div className="card-title"><div><span>SAFETY REVIEW</span><h3>{selectedStep.title}</h3></div><Tag intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag></div>
                  <div className="review-facts">
                    <div><span>预计时间</span><strong>{selectedStep.duration} 分钟</strong></div>
                    <div><span>材料与用量</span><strong>{selectedStep.materials} / {selectedStep.amount}</strong></div>
                    <div><span>危险项</span><strong>{selectedStep.hazards.join('、') || '无'}</strong></div>
                  </div>
                  <div className="review-section"><h4>控制措施</h4><p>{selectedStep.controls || '未填写'}</p></div>
                  <div className="review-section"><h4>安全说明</h4><p className={hasMissingSafety(selectedStep) ? 'danger-text' : ''}>{selectedStep.safetyNote || '未填写'}</p></div>
                  {hasMissingSafety(selectedStep) && <Callout intent="danger" icon="warning-sign">当前步骤存在安全信息缺口，不能确认或冻结版本。</Callout>}
                  <StepPermitNotice
                    permits={process.permits}
                    stepId={selectedStep.id}
                    reviewer
                    onRestore={restorePermitValues}
                    onGotoPermits={() => setActiveView('permits')}
                    onRevoke={revokePermit}
                  />
                </Card>
                <Card elevation={Elevation.ONE} className="comment-card">
                  <div className="card-title"><div><span>REVIEW COMMENTS</span><h3>复核批注</h3></div><Tag minimal>{selectedStep.comments.length} 条</Tag></div>
                  <div className="comment-compose">
                    <TextArea fill value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="填写具体依据、风险或修改建议…" />
                    <Button intent="primary" icon="comment" text="添加批注" disabled={!commentText.trim()} onClick={addReviewComment} />
                  </div>
                  <div className="comment-list">
                    {selectedStep.comments.map((comment) => (
                      <article key={comment.id} className={comment.resolved ? 'resolved' : ''}>
                        <div className="comment-avatar">{comment.author.slice(0, 1)}</div>
                        <div><header><strong>{comment.author}</strong><span>{comment.role}</span><time>{formatDate(comment.createdAt)}</time></header><p>{comment.text}</p><Button minimal small text={comment.resolved ? '已解决' : '标记解决'} icon={comment.resolved ? 'tick' : 'circle'} onClick={() => resolveComment(comment.id)} /></div>
                      </article>
                    ))}
                    {!selectedStep.comments.length && <p className="muted">当前步骤尚未添加复核批注。</p>}
                  </div>
                </Card>
              </>
            )}
          </section>
          <aside className="review-actions">
            <Card elevation={Elevation.ONE}>
              <div className="card-title"><div><span>REVIEWER ACTION</span><h3>复核决定</h3></div><Icon icon="endorsed" size={18} /></div>
              {selectedStep && hasBlockingPermit(process.permits, selectedStep.id) && (
                <Callout intent="danger" icon="shield" className="permit-gate-callout">
                  <strong>偏离许可未关闭，不能确认</strong>
                  <p>该步骤存在待审/未通过/已到期的偏离许可，须先在「偏离许可」页处理并恢复原值、重新复核后才能确认。</p>
                  <Button small fill icon="shield" text="前往处理许可" onClick={() => setActiveView('permits')} />
                </Callout>
              )}
              <p className="muted">确认后若修改该步骤，受影响的下游步骤会在编辑页重新提示。</p>
              <Button fill large intent="success" icon="tick" text="逐条确认" disabled={hasMissingSafety(selectedStep) || (!!selectedStep && hasBlockingPermit(process.permits, selectedStep.id))} onClick={() => setStepStatus('confirmed')} />
              <Button fill large icon="undo" text="退回修改" intent="warning" onClick={() => setStepStatus('returned')} />
              <Button fill large minimal icon="refresh" text="恢复为待复核" disabled={!!selectedStep && hasBlockingPermit(process.permits, selectedStep.id)} onClick={() => setStepStatus('submitted')} />
              <Divider />
              <div className="review-progress-list">
                {process.steps.map((step) => <div key={step.id}><span>{step.title}{hasBlockingPermit(process.permits, step.id) && <Icon icon="shield" intent="danger" size={11} />}</span><Tag minimal intent={step.status === 'confirmed' ? 'success' : step.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(step.status)}</Tag></div>)}
              </div>
              <Button fill intent="primary" icon="lock" text="全部确认后冻结" onClick={freezeVersion} disabled={process.status === 'frozen' || blockingStepCount > 0} />
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'permits' && (
        <main className="permits-layout">
          <section className="permits-main">
            <Card elevation={Elevation.ONE} className="permits-overview">
              <div className="card-title">
                <div><span>DEVIATION PERMITS</span><h3>偏离许可台账</h3></div>
                <Button icon="plus" intent="primary" text="新建偏离申请" onClick={() => openPermitForm(selectedStep?.id ?? process.steps[0]?.id ?? '')} />
              </div>
              <div className="permit-stat-grid">
                <div><strong>{pendingPermitCount}</strong><span>待审批</span></div>
                <div><strong>{process.permits.filter((permit) => permit.status === 'active').length}</strong><span>生效中</span></div>
                <div><strong>{blockingStepCount}</strong><span>阻断确认步骤</span></div>
                <div><strong>{process.permits.length}</strong><span>累计许可记录</span></div>
              </div>
              <Callout intent="primary" icon="info-sign" className="permit-rule-callout">
                记录先进入「待审」；未通过或已过期的步骤不能确认。批准后按生效时段套用临时值并锁定字段；被改字段后续变化、许可撤销或到期时，原确认立即失效，下游步骤重新复核，复核人同意后才恢复。全部记录随本地数据与版本快照保存。
              </Callout>
            </Card>

            {showPermitForm && (
              <Card elevation={Elevation.TWO} className="permit-form-card">
                <div className="card-title">
                  <div><span>NEW DEVIATION</span><h3>新建偏离许可申请</h3></div>
                  <Button minimal icon="cross" onClick={() => setShowPermitForm(false)} />
                </div>
                <FormGroup label="偏离步骤" labelFor="permit-step">
                  <HTMLSelect id="permit-step" fill value={permitStepId} onChange={(event) => setPermitStepId(event.target.value)}>
                    {process.steps.map((step, index) => <option key={step.id} value={step.id}>{String(index + 1).padStart(2, '0')} · {step.title}</option>)}
                  </HTMLSelect>
                </FormGroup>
                <FormGroup label="受影响字段（可多选）" labelInfo="（必选）">
                  <div className="permit-field-picker">
                    {DEVIATION_FIELDS.map(({ key, label }) => (
                      <Checkbox key={key} checked={permitFieldKeys.includes(key)} label={label} onChange={(event) => togglePermitField(key, event.currentTarget.checked)} />
                    ))}
                  </div>
                </FormGroup>
                {permitFieldKeys.map((field) => {
                  const formStep = process.steps.find((step) => step.id === permitStepId);
                  const original = formStep ? readStepField(formStep, field) : '';
                  const temporary = permitTempValues[field] ?? '';
                  const longText = field === 'hazards' || field === 'controls' || field === 'safetyNote' || field === 'purpose' || field === 'expectedResult' || field === 'materials' || field === 'equipment' || field === 'amount';
                  return (
                    <div className="permit-field-row" key={field}>
                      <div className="permit-field-original"><span>{fieldLabel(field)} · 原值</span><p>{original || '（空）'}</p></div>
                      <FormGroup label={`${fieldLabel(field)} · 临时值`} labelFor={`temp-${field}`}>
                        {longText
                          ? <TextArea id={`temp-${field}`} fill value={temporary} onChange={(event) => setPermitTempValues((current) => ({ ...current, [field]: event.target.value }))} />
                          : <InputGroup id={`temp-${field}`} fill value={temporary} onChange={(event) => setPermitTempValues((current) => ({ ...current, [field]: event.target.value }))} />}
                      </FormGroup>
                    </div>
                  );
                })}
                <div className="form-grid">
                  <FormGroup label="生效时间" labelFor="permit-from" labelInfo="（必填）">
                    <InputGroup id="permit-from" type="datetime-local" fill value={permitFrom} onChange={(event) => setPermitFrom(event.target.value)} />
                  </FormGroup>
                  <FormGroup label="失效时间" labelFor="permit-until" labelInfo="（必填）">
                    <InputGroup id="permit-until" type="datetime-local" fill value={permitUntil} onChange={(event) => setPermitUntil(event.target.value)} />
                  </FormGroup>
                </div>
                <FormGroup label="偏离原因 / 批准依据" labelFor="permit-reason" labelInfo="（必填）">
                  <TextArea id="permit-reason" fill placeholder="例如：临时换料、库存批号变化、设备参数放宽…需说明背景与影响判断。" value={permitReason} onChange={(event) => setPermitReason(event.target.value)} />
                </FormGroup>
                <FormGroup label="临时控制措施" labelFor="permit-controls" labelInfo="（必填）">
                  <TextArea id="permit-controls" fill placeholder="偏离期间额外采取的防护、监护、限量或记录要求。" value={permitControls} onChange={(event) => setPermitControls(event.target.value)} />
                </FormGroup>
                <div className="permit-form-actions">
                  <Button text="取消" onClick={() => setShowPermitForm(false)} />
                  <Button intent="primary" icon="send-to" text="提交待审" onClick={submitPermit} />
                </div>
              </Card>
            )}

            <div className="permit-list">
              {[...process.permits].reverse().map((permit) => (
                <PermitCard
                  key={permit.id}
                  permit={permit}
                  steps={process.steps}
                  reviewNote={reviewNote}
                  onReviewNoteChange={setReviewNote}
                  onApprove={() => decidePermit(permit.id, true)}
                  onReject={() => decidePermit(permit.id, false)}
                  onRevoke={() => revokePermit(permit.id)}
                  onWithdraw={() => withdrawPermit(permit.id)}
                  onRestore={() => restorePermitValues(permit.id)}
                  onSelectStep={(stepId) => { setSelectedStepId(stepId); setActiveView('review'); }}
                />
              ))}
              {!process.permits.length && (
                <Card elevation={Elevation.ONE} className="empty-permits">
                  <Icon icon="shield" size={30} />
                  <strong>暂无偏离许可记录</strong>
                  <p>实验中途需要临时换材料或放宽控制时，请先提交偏离许可，不得直接改步骤。</p>
                </Card>
              )}
            </div>
          </section>
        </main>
      )}

      {activeView === 'compare' && (
        <main className="compare-layout">
          <Card elevation={Elevation.ONE} className="version-panel">
            <div className="card-title"><div><span>VERSION TIMELINE</span><h3>冻结版本</h3></div><Tag minimal>{process.versions.length} 个</Tag></div>
            <div className="version-timeline">
              {process.versions.map((version, index) => (
                <article key={version.id} className={index === process.versions.length - 1 ? 'latest' : ''}>
                  <span></span><div><b>{version.version}</b><strong>{version.label}</strong><p>{formatDate(version.createdAt)} · {version.steps.length} 个步骤 · {version.author}</p><p className="permit-snapshot-line"><Icon icon="shield" size={11} /> 含偏离许可记录 {version.permits?.length ?? 0} 条</p><small>{version.note}</small></div>
                </article>
              ))}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="diff-panel">
            <div className="card-title"><div><span>VERSION DIFF</span><h3>流程差异比较</h3></div><div className="diff-selects">
              <HTMLSelect value={compareBaseId} onChange={(event) => setCompareBaseId(event.target.value)}>{process.versions.map((version) => <option key={version.id} value={version.id}>{version.version} · 基准</option>)}</HTMLSelect>
              <Icon icon="arrow-right" />
              <HTMLSelect value={compareTargetId} onChange={(event) => setCompareTargetId(event.target.value)}>{process.versions.map((version) => <option key={version.id} value={version.id}>{version.version} · 目标</option>)}</HTMLSelect>
            </div></div>
            <div className="diff-table">
              <div className="diff-head"><span>变更类型</span><span>步骤</span><span>具体内容</span></div>
              {versionDiff.map((diff) => <div className={`diff-row ${diff.kind}`} key={diff.id}><Tag minimal intent={diff.kind === 'added' ? 'success' : diff.kind === 'removed' ? 'danger' : 'primary'}>{diff.kind === 'added' ? '新增' : diff.kind === 'removed' ? '删除' : '修改'}</Tag><strong>{diff.title}</strong><p>{diff.detail}</p></div>)}
              {!versionDiff.length && <div className="empty-diff"><Icon icon="comparison" size={30} /><strong>两个版本没有差异</strong><p>请选择不同版本，或先冻结新的流程版本。</p></div>}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="freeze-rules">
            <div className="card-title"><div><span>FREEZE RULES</span><h3>冻结检查</h3></div></div>
            <div className={confirmedCount === process.steps.length ? 'passed' : ''}><Icon icon={confirmedCount === process.steps.length ? 'tick-circle' : 'circle'} /><span><strong>所有步骤已确认</strong><small>{confirmedCount}/{process.steps.length}</small></span></div>
            <div className={!missingSafetySteps.length ? 'passed' : ''}><Icon icon={!missingSafetySteps.length ? 'tick-circle' : 'circle'} /><span><strong>安全信息完整</strong><small>{missingSafetySteps.length} 个缺口</small></span></div>
            <div className={blockingStepCount === 0 ? 'passed' : ''}><Icon icon={blockingStepCount === 0 ? 'tick-circle' : 'warning-sign'} /><span><strong>偏离许可全部关闭</strong><small>{blockingStepCount} 个步骤仍被阻断</small></span></div>
            <div className={process.steps.every((step) => step.dependencies.every((id) => process.steps.some((item) => item.id === id))) ? 'passed' : ''}><Icon icon="git-merge" /><span><strong>依赖引用有效</strong><small>{process.steps.reduce((sum, step) => sum + step.dependencies.length, 0)} 条依赖</small></span></div>
            <Button fill intent="primary" icon="lock" text="冻结当前版本" onClick={freezeVersion} disabled={process.status === 'frozen' || confirmedCount !== process.steps.length || missingSafetySteps.length > 0 || blockingStepCount > 0} />
          </Card>
        </main>
      )}

      <footer className="app-footer">
        <span>所有实验数据仅保存在当前浏览器 localStorage。</span>
        <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Ctrl/Cmd + S 保存</span>
      </footer>
    </div>
  );
}

function hasMissingSafety(step: ProcessStep): boolean {
  return step.hazards.length > 0 && (!step.controls.trim() || !step.safetyNote.trim());
}

function collectDownstream(steps: ProcessStep[], sourceId: string | null): string[] {
  if (!sourceId) return [];
  const result = new Set<string>();
  const visit = (id: string) => {
    steps.filter((step) => step.dependencies.includes(id)).forEach((step) => {
      if (result.has(step.id)) return;
      result.add(step.id);
      visit(step.id);
    });
  };
  visit(sourceId);
  return [...result];
}

function nextMinorVersion(value: string): string {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return '1.2.0';
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function compareVersions(process: ExperimentProcess, baseId: string, targetId: string): DiffItem[] {
  const base = process.versions.find((version) => version.id === baseId);
  const target = process.versions.find((version) => version.id === targetId);
  if (!base || !target) return [];
  const diffs: DiffItem[] = [];
  const targetMap = new Map(target.steps.map((step) => [step.id, step]));
  const baseMap = new Map(base.steps.map((step) => [step.id, step]));
  base.steps.forEach((step) => {
    if (!targetMap.has(step.id)) diffs.push({ id: step.id, title: step.title, kind: 'removed', detail: '目标版本已删除该步骤。' });
  });
  target.steps.forEach((step) => {
    const before = baseMap.get(step.id);
    if (!before) {
      diffs.push({ id: step.id, title: step.title, kind: 'added', detail: `${step.duration} 分钟；危险项：${step.hazards.join('、') || '无'}` });
      return;
    }
    const fields: string[] = [];
    if (before.title !== step.title) fields.push('名称');
    if (before.purpose !== step.purpose) fields.push('目的');
    if (before.materials !== step.materials || before.amount !== step.amount) fields.push('材料或用量');
    if (before.equipment !== step.equipment) fields.push('设备');
    if (before.duration !== step.duration) fields.push('预计时间');
    if (JSON.stringify(before.hazards) !== JSON.stringify(step.hazards)) fields.push('危险项');
    if (before.controls !== step.controls || before.safetyNote !== step.safetyNote) fields.push('安全控制');
    if (JSON.stringify(before.dependencies) !== JSON.stringify(step.dependencies)) fields.push('依赖关系');
    if (before.expectedResult !== step.expectedResult) fields.push('预期结果');
    if (fields.length) diffs.push({ id: step.id, title: step.title, kind: 'changed', detail: `变化字段：${fields.join('、')}。` });
  });
  // 偏离许可记录也是版本快照的一部分：新增许可、许可状态推进都会显示在差异中。
  const basePermits = base.permits ?? [];
  const targetPermits = target.permits ?? [];
  const basePermitMap = new Map(basePermits.map((permit) => [permit.id, permit]));
  targetPermits.forEach((permit) => {
    const before = basePermitMap.get(permit.id);
    if (!before) {
      diffs.push({
        id: `permit-${permit.id}`,
        title: `偏离许可 ${permit.code}`,
        kind: 'added',
        detail: `步骤「${permit.stepTitle}」新增${permitStatusLabel(permit.status)}许可，字段：${permit.fields.map((change) => fieldLabel(change.field)).join('、')}；生效时段 ${formatWindow(permit)}。`
      });
      return;
    }
    if (before.status !== permit.status || before.events.length !== permit.events.length) {
      diffs.push({
        id: `permit-${permit.id}`,
        title: `偏离许可 ${permit.code}`,
        kind: 'changed',
        detail: `步骤「${permit.stepTitle}」许可状态由「${permitStatusLabel(before.status)}」变为「${permitStatusLabel(permit.status)}」，事件 ${before.events.length} → ${permit.events.length} 条。`
      });
    }
  });
  return diffs;
}

function lockedFieldHint(stepId: string, field: DeviationFieldKey, permits: DeviationPermit[]): string {
  const locker = activePermitsForStep(permits, stepId).find((permit) => permit.fields.some((change) => change.field === field));
  return locker ? `字段由偏离许可 ${locker.code} 锁定（生效至 ${formatDate(locker.effectiveUntil)}），到期或撤销并恢复原值后可编辑。` : '';
}

interface StepPermitNoticeProps {
  permits: DeviationPermit[];
  stepId: string;
  reviewer?: boolean;
  onRestore: (permitId: string) => void;
  onGotoPermits: () => void;
  onRevoke: (permitId: string) => void;
}

function StepPermitNotice({ permits, stepId, reviewer, onRestore, onGotoPermits, onRevoke }: StepPermitNoticeProps) {
  const related = permits.filter((permit) => permit.stepId === stepId);
  const blocking = related.filter(isPermitBlocking);
  const active = related.filter((permit) => permit.status === 'active');
  const approved = related.filter((permit) => permit.status === 'approved');
  if (!related.length) return null;
  return (
    <div className="step-permit-notice">
      {active.map((permit) => (
        <Callout key={permit.id} intent="success" icon="shield" className="permit-callout">
          <strong>偏离许可 {permit.code} 生效中（{formatWindow(permit)}）</strong>
          <p>以下字段正按批准的临时值执行并锁定：{permit.fields.map((change) => fieldLabel(change.field)).join('、')}。到期或撤销后原确认立即失效，须复核人重新确认。</p>
          <div className="permit-callout-actions">
            <Button small minimal icon="layers" text="查看许可依据" onClick={onGotoPermits} />
            {reviewer && <Button small minimal intent="danger" icon="disable" text="撤销许可" onClick={() => onRevoke(permit.id)} />}
          </div>
        </Callout>
      ))}
      {approved.map((permit) => (
        <Callout key={permit.id} intent="primary" icon="time" className="permit-callout">
          <strong>偏离许可 {permit.code} 已批准，{formatDate(permit.effectiveFrom)} 起生效</strong>
          <p>到点后系统自动套用临时值；批准依据已记录，下游已确认步骤需重新复核。</p>
        </Callout>
      ))}
      {blocking.map((permit) => (
        <Callout key={permit.id} intent="danger" icon="warning-sign" className="permit-callout">
          <strong>偏离许可 {permit.code}：{permitStatusLabel(permit.status)}，本步骤不能确认</strong>
          <p>{permit.invalidatedReason ?? '许可尚未通过审批。'}{!permit.restored && isPermitDead(permit.status) ? ' 请先恢复原值再提交复核。' : ''}</p>
          <div className="permit-callout-actions">
            <Button small minimal icon="layers" text="查看许可记录" onClick={onGotoPermits} />
            {isPermitDead(permit.status) && !permit.restored && (
              <Button small minimal intent="warning" icon="reset" text="恢复原值" onClick={() => onRestore(permit.id)} />
            )}
          </div>
        </Callout>
      ))}
    </div>
  );
}

interface PermitCardProps {
  permit: DeviationPermit;
  steps: ProcessStep[];
  reviewNote: string;
  onReviewNoteChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRevoke: () => void;
  onWithdraw: () => void;
  onRestore: () => void;
  onSelectStep: (stepId: string) => void;
}

function PermitCard({
  permit, steps, reviewNote, onReviewNoteChange, onApprove, onReject, onRevoke, onWithdraw, onRestore, onSelectStep
}: PermitCardProps) {
  const step = steps.find((item) => item.id === permit.stepId);
  const downstream = permit.downstreamStepIds
    .map((id) => steps.find((item) => item.id === id))
    .filter((item): item is ProcessStep => Boolean(item));
  const dead = isPermitDead(permit.status);
  return (
    <Card elevation={Elevation.ONE} className={`permit-card status-${permit.status}`}>
      <div className="permit-card-head">
        <div>
          <div className="permit-code-line"><Icon icon="shield" size={14} /><span>{permit.code}</span><Tag minimal intent={permitStatusIntent(permit.status)}>{permitStatusLabel(permit.status)}</Tag></div>
          <h3>{permit.stepTitle}</h3>
        </div>
        <div className="permit-window">
          <span>生效时段</span>
          <strong>{formatWindow(permit)}</strong>
        </div>
      </div>

      <div className="permit-field-table">
        <div className="permit-field-table-head"><span>受影响字段</span><span>原值</span><span>临时值</span></div>
        {permit.fields.map((change) => {
          const currentValue = step ? readStepField(step, change.field) : '';
          // 仅在生效中检测漂移：已批准待生效时步骤仍是原值，属正常。
          const drifted = permit.status === 'active' && currentValue !== change.temporaryValue;
          return (
            <div className="permit-field-table-row" key={change.field}>
              <span><Icon icon={drifted ? 'warning-sign' : 'swap-horizontal'} intent={drifted ? 'danger' : 'none'} size={12} />{fieldLabel(change.field)}</span>
              <em>{change.originalValue || '（空）'}</em>
              <strong>{change.temporaryValue}{drifted && <small className="danger-text">当前值已偏离临时值</small>}</strong>
            </div>
          );
        })}
      </div>

      <div className="permit-detail-grid">
        <div><span>偏离原因 / 批准依据</span><p>{permit.reason}</p></div>
        <div><span>临时控制措施</span><p>{permit.controls}</p></div>
      </div>

      <div className="permit-meta-line">
        <span>申请人：{permit.applicant}</span>
        <span>提交：{formatDate(permit.createdAt)}</span>
        {permit.reviewer && <span>复核人：{permit.reviewer}</span>}
        {permit.appliedAt && <span>套用：{formatDate(permit.appliedAt)}</span>}
        {permit.invalidatedAt && <span>失效：{formatDate(permit.invalidatedAt)}</span>}
      </div>

      {permit.downstreamStepIds.length > 0 && (
        <div className="permit-downstream">
          <span>受影响下游（批准/失效后需重新复核）：</span>
          {downstream.map((item) => (
            <button key={item.id} onClick={() => onSelectStep(item.id)}>
              {item.title}
              <Tag minimal intent={item.status === 'confirmed' ? 'success' : item.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(item.status)}</Tag>
            </button>
          ))}
        </div>
      )}

      {permit.reviewNote && (
        <div className={`permit-review-note ${permit.status === 'rejected' ? 'rejected' : ''}`}>
          <Icon icon={permit.status === 'rejected' ? 'cross-circle' : 'endorsed'} size={14} intent={permit.status === 'rejected' ? 'danger' : 'success'} />
          <div><strong>复核意见 · {permit.reviewer}</strong><p>{permit.reviewNote}</p></div>
        </div>
      )}

      {permit.status === 'pending' && (
        <div className="permit-review-box">
          <TextArea fill placeholder="复核人填写批准依据或驳回理由（可选，将计入事件记录）…" value={reviewNote} onChange={(event) => onReviewNoteChange(event.target.value)} />
          <div className="permit-action-row">
            <Button minimal icon="undo" text="申请人撤回" onClick={onWithdraw} />
            <div>
              <Button intent="danger" icon="cross" text="驳回" onClick={onReject} />
              <Button intent="success" icon="tick" text="批准许可" onClick={onApprove} />
            </div>
          </div>
        </div>
      )}
      {(permit.status === 'active' || permit.status === 'approved') && (
        <div className="permit-action-row">
          <span className="muted">{permit.status === 'active' ? '字段锁定中；撤销或到期后原确认立即失效。' : '到生效时间自动套用临时值。'}</span>
          <Button intent="danger" minimal icon="disable" text="撤销许可" onClick={onRevoke} />
        </div>
      )}
      {dead && (
        <div className="permit-action-row">
          <span className="muted">{permit.restored ? '原值已恢复，等待复核人重新确认步骤。' : '许可已失效，恢复原值并经复核人同意后步骤才能确认。'}</span>
          {!permit.restored && <Button intent="warning" icon="reset" text="恢复原值" onClick={onRestore} />}
        </div>
      )}

      <div className="permit-timeline">
        {permit.events.map((event) => (
          <div className="permit-event" key={event.id}>
            <span className="permit-event-dot"></span>
            <div>
              <header><strong>{permitEventLabel(event.type)}</strong><em>{event.author} · {event.role}</em><time>{formatDate(event.at)}</time></header>
              <p>{event.note}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default App;
