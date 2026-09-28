import type {
  DeviableField,
  DeviationField,
  DeviationPermit,
  ExperimentProcess,
  PermitAuditEvent,
  PermitStatus,
  ProcessStep,
  StepStatus
} from './types';

export const FIELD_LABELS: Record<DeviableField, string> = {
  title: '步骤名称',
  purpose: '操作目的',
  materials: '材料',
  equipment: '设备',
  amount: '用量/参数',
  duration: '预计时间',
  hazards: '危险项',
  controls: '控制措施',
  safetyNote: '安全说明',
  expectedResult: '预期结果'
};

export const PERMIT_STATUS_LABEL: Record<PermitStatus, string> = {
  pending: '待审',
  rejected: '未通过',
  approved: '已批准生效',
  expired: '已到期',
  revoked: '已撤销',
  invalidated: '字段漂移失效',
  restored: '已同意恢复',
  withdrawn: '已撤回'
};

export const PERMIT_STATUS_INTENT: Record<PermitStatus, 'danger' | 'success' | 'warning' | 'none' | 'primary'> = {
  pending: 'warning',
  rejected: 'danger',
  approved: 'success',
  expired: 'danger',
  revoked: 'danger',
  invalidated: 'danger',
  restored: 'none',
  withdrawn: 'none'
};

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  draft: '草稿',
  submitted: '待复核',
  confirmed: '已确认',
  returned: '已退回',
  invalidated: '确认已失效'
};

/** 字段值统一转成可比较的字符串（危险项数组与输入串归一） */
export function serializeField(step: ProcessStep, field: DeviableField): string {
  const value = step[field as keyof ProcessStep];
  if (field === 'hazards') return (value as string[]).join('，');
  if (field === 'duration') return String(value);
  return String(value ?? '');
}

export function isListField(field: DeviableField): boolean {
  return field === 'hazards';
}

export function parseListInput(value: string): string[] {
  return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

export function activePermitFor(permits: DeviationPermit[], stepId: string, atIso: string): DeviationPermit | undefined {
  return permits.find((permit) =>
    permit.stepId === stepId &&
    permit.status === 'approved' &&
    permit.startTime <= atIso &&
    atIso < permit.endTime
  );
}

export function blockingPermitFor(permits: DeviationPermit[], stepId: string, atIso: string): DeviationPermit | undefined {
  return permits.find((permit) => permit.stepId === stepId && isPermitBlocking(permit, atIso));
}

/** 这些状态下该步骤不能确认；approved 且窗口内不拦截 */
export function isPermitBlocking(permit: DeviationPermit, atIso: string): boolean {
  if (permit.status === 'pending' || permit.status === 'rejected') return true;
  if (permit.status === 'revoked' || permit.status === 'invalidated' || permit.status === 'expired') return true;
  if (permit.status === 'approved' && (atIso < permit.startTime || atIso >= permit.endTime)) return true;
  return false;
}

/** 许可是否应在字段编辑面板中锁定（待审期间不允许改动被申请字段） */
export function isStepPermitPending(permits: DeviationPermit[], stepId: string): boolean {
  return permits.some((permit) => permit.stepId === stepId && permit.status === 'pending');
}

export function lockedFieldsForStep(permits: DeviationPermit[], stepId: string): Set<DeviableField> {
  const fields = new Set<DeviableField>();
  permits
    .filter((permit) => permit.stepId === stepId && permit.status === 'pending')
    .forEach((permit) => permit.fields.forEach((change) => fields.add(change.field)));
  return fields;
}

function permitEvent(action: PermitAuditEvent['action'], actor: string, role: string, note: string): PermitAuditEvent {
  return { id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), actor, role, action, note };
}

/** 计算被某步骤（传递）依赖的所有下游步骤 */
export function collectDownstreamIds(steps: ProcessStep[], sourceId: string): string[] {
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

/** 已确认的下游全部打回重新复核 */
function cascadeDownstream(steps: ProcessStep[], sourceId: string, note: string, eventsTarget?: { permit: DeviationPermit; actor: string; role: string }): string[] {
  const downstream = collectDownstreamIds(steps, sourceId);
  const reset: string[] = [];
  steps.forEach((step) => {
    if (downstream.includes(step.id) && (step.status === 'confirmed' || step.status === 'invalidated')) {
      step.status = 'submitted';
      reset.push(step.title);
    }
  });
  if (eventsTarget && reset.length) {
    eventsTarget.permit.events.push(
      permitEvent('cascade', eventsTarget.actor, eventsTarget.role, `${note}，下游重新复核：${reset.join('、')}`)
    );
  }
  return reset;
}

/**
 * 生效许可的临时值写入步骤字段。
 * 幂等：仅当当前字段值等于原值（或已是该临时值）时套用，漂移由 reconcile 处理。
 */
function applyPermit(step: ProcessStep, permit: DeviationPermit): void {
  permit.fields.forEach((change) => {
    const current = serializeField(step, change.field);
    if (current === change.originalValue || current === change.temporaryValue) {
      writeField(step, change.field, change.temporaryValue);
    }
  });
}

/** 许可失效后恢复原值（仅当当前仍是临时值时恢复；若用户已改动则保持漂移现场） */
function revertPermit(step: ProcessStep, permit: DeviationPermit): void {
  permit.fields.forEach((change) => {
    const current = serializeField(step, change.field);
    if (current === change.temporaryValue) writeField(step, change.field, change.originalValue);
  });
}

function writeField(step: ProcessStep, field: DeviableField, raw: string): void {
  if (field === 'hazards') {
    (step as unknown as Record<string, unknown>).hazards = parseListInput(raw);
  } else if (field === 'duration') {
    const num = Number(raw);
    (step as unknown as Record<string, unknown>).duration = Number.isFinite(num) ? num : 0;
  } else {
    (step as unknown as Record<string, unknown>)[field] = raw;
  }
}

/**
 * 统一状态协调：在每次提交与每次时钟刷新后运行。
 * - 到期的已批准许可 → expired：撤回临时值，本步骤确认失效，下游重新复核
 * - 已生效许可字段被改动 → invalidated：同上
 * 纯函数（就地修改 draft），不产生 React 状态更新。
 */
export function reconcilePermits(draft: ExperimentProcess, atIso: string, actor = '系统', role = '自动校验'): void {
  if (draft.status === 'frozen') return;
  draft.permits.forEach((permit) => {
    if (permit.status !== 'approved') return;
    const step = draft.steps.find((item) => item.id === permit.stepId);
    if (!step) return;

    if (atIso >= permit.endTime) {
      revertPermit(step, permit);
      permit.status = 'expired';
      permit.reviewNote = '生效时段已结束，临时值自动撤回；需复核人同意恢复后方可重新确认。';
      permit.events.push(permitEvent('expired', actor, role, '生效时段到期，许可自动失效'));
      permit.events.push(permitEvent('reverted', actor, role, '临时值恢复为许可前原值'));
      step.status = 'invalidated';
      cascadeDownstream(draft.steps, step.id, '许可到期', { permit, actor, role });
      return;
    }

    const drifted = permit.fields.some((change) => {
      const current = serializeField(step, change.field);
      return current !== change.temporaryValue && current !== change.originalValue;
    });
    if (drifted) {
      permit.status = 'invalidated';
      permit.reviewNote = '被许可字段在生效期间发生许可外修改，原确认立即失效，需复核人同意恢复。';
      permit.events.push(permitEvent('invalidated', actor, role, '被改字段后续变化，许可自动失效'));
      step.status = 'invalidated';
      cascadeDownstream(draft.steps, step.id, '字段漂移失效', { permit, actor, role });
    }
  });
}

export interface CreatePermitInput {
  stepId: string;
  reason: string;
  compensatingControls: string;
  startTime: string;
  endTime: string;
  changes: { field: DeviableField; temporaryValue: string }[];
  author: string;
  authorRole: string;
  /** 可选预生成 ID，便于调用方在提交后立即定位记录（React dispatch 异步） */
  id?: string;
  code?: string;
}

/** 研究员申请偏离：记录先保存为待审，本步骤及下游已确认内容立即失效等待重新复核 */
export function createPermit(draft: ExperimentProcess, input: CreatePermitInput): DeviationPermit | null {
  const step = draft.steps.find((item) => item.id === input.stepId);
  if (!step || !input.reason.trim() || input.changes.length === 0 || input.endTime <= input.startTime) return null;
  if (draft.permits.some((permit) => permit.stepId === input.stepId && permit.status === 'pending')) return null;

  const fields: DeviationField[] = input.changes.map((change) => ({
    field: change.field,
    originalValue: serializeField(step, change.field),
    temporaryValue: change.temporaryValue
  }));

  const now = new Date().toISOString();
  const seq = draft.permits.length + 1;
  const permit: DeviationPermit = {
    id: input.id ?? `permit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    code: input.code ?? `DEV-${String(seq).padStart(3, '0')}`,
    stepId: step.id,
    stepTitle: step.title,
    reason: input.reason.trim(),
    compensatingControls: input.compensatingControls.trim(),
    startTime: input.startTime,
    endTime: input.endTime,
    fields,
    status: 'pending',
    createdAt: now,
    createdBy: input.author,
    createdByRole: input.authorRole,
    events: [permitEvent('created', input.author, input.authorRole, `申请 ${fields.length} 个字段临时偏离，等待复核批准`)]
  };
  draft.permits.push(permit);

  // 待审期间该步骤不能确认；若此前已确认，立即打回
  if (step.status === 'confirmed' || step.status === 'invalidated') step.status = 'submitted';
  cascadeDownstream(draft.steps, step.id, '提交偏离申请', { permit, actor: input.author, role: input.authorRole });
  return permit;
}

/** 复核人批准：临时值才正式写入步骤；本步骤与下游重新复核，同意后才恢复确认 */
export function approvePermit(draft: ExperimentProcess, permitId: string, reviewer: string, reviewerRole: string, note: string): void {
  const permit = draft.permits.find((item) => item.id === permitId);
  const step = permit && draft.steps.find((item) => item.id === permit.stepId);
  if (!permit || !step || permit.status !== 'pending') return;
  const now = new Date().toISOString();

  permit.status = 'approved';
  permit.decidedAt = now;
  permit.decidedBy = reviewer;
  permit.decidedByRole = reviewerRole;
  permit.decisionNote = note.trim() || undefined;
  permit.events.push(permitEvent('approved', reviewer, reviewerRole, note.trim() || '批准偏离，临时值生效'));

  applyPermit(step, permit);
  permit.events.push(permitEvent('applied', reviewer, reviewerRole, '临时值写入步骤字段'));

  // 批准后仍需以临时值重新完成复核确认
  if (step.status === 'confirmed') step.status = 'submitted';
  cascadeDownstream(draft.steps, step.id, '偏离生效，需重新复核', { permit, actor: reviewer, role: reviewerRole });
  reconcilePermits(draft, now, reviewer, reviewerRole);
}

export function rejectPermit(draft: ExperimentProcess, permitId: string, reviewer: string, reviewerRole: string, note: string): void {
  const permit = draft.permits.find((item) => item.id === permitId);
  if (!permit || permit.status !== 'pending') return;
  permit.status = 'rejected';
  permit.decidedAt = new Date().toISOString();
  permit.decidedBy = reviewer;
  permit.decidedByRole = reviewerRole;
  permit.decisionNote = note.trim() || undefined;
  permit.events.push(permitEvent('rejected', reviewer, reviewerRole, note.trim() || '未通过，偏离不得执行'));
}

/** 复核人撤销生效中的许可：立即恢复原值，确认失效，下游重新复核 */
export function revokePermit(draft: ExperimentProcess, permitId: string, reviewer: string, reviewerRole: string, note: string): void {
  const permit = draft.permits.find((item) => item.id === permitId);
  const step = permit && draft.steps.find((item) => item.id === permit.stepId);
  if (!permit || !step || permit.status !== 'approved') return;
  revertPermit(step, permit);
  permit.status = 'revoked';
  permit.decidedAt = new Date().toISOString();
  permit.decidedBy = reviewer;
  permit.decidedByRole = reviewerRole;
  permit.decisionNote = note.trim() || undefined;
  permit.reviewNote = '许可已撤销，临时值撤回；需复核人同意恢复后方可重新确认。';
  permit.events.push(permitEvent('revoked', reviewer, reviewerRole, note.trim() || '复核人撤销许可'));
  permit.events.push(permitEvent('reverted', reviewer, reviewerRole, '临时值恢复为原值'));
  step.status = 'invalidated';
  cascadeDownstream(draft.steps, step.id, '许可撤销', { permit, actor: reviewer, role: reviewerRole });
}

/** 复核人同意恢复（针对到期/撤销/漂移失效）：步骤重新进入复核队列，许可关闭 */
export function restorePermit(draft: ExperimentProcess, permitId: string, reviewer: string, reviewerRole: string, note: string): void {
  const permit = draft.permits.find((item) => item.id === permitId);
  const step = permit && draft.steps.find((item) => item.id === permit.stepId);
  if (!permit || !step) return;
  if (!['expired', 'revoked', 'invalidated'].includes(permit.status)) return;
  permit.status = 'restored';
  permit.reviewNote = note.trim() || '复核人已核对现场与记录，同意按原值恢复，可重新确认。';
  permit.events.push(permitEvent('restored', reviewer, reviewerRole, permit.reviewNote));
  step.status = 'submitted';
}

/** 申请人撤回待审/未通过申请 */
export function withdrawPermit(draft: ExperimentProcess, permitId: string, actor: string, role: string): void {
  const permit = draft.permits.find((item) => item.id === permitId);
  if (!permit || !['pending', 'rejected'].includes(permit.status)) return;
  permit.status = 'withdrawn';
  permit.events.push(permitEvent('withdrawn', actor, role, '申请人撤回该偏离申请'));
}

/** 未通过/撤回后重新提交：旧记录标记被取代，新记录保留原值快照链 */
export function resubmitPermit(
  draft: ExperimentProcess,
  oldPermitId: string,
  input: CreatePermitInput
): DeviationPermit | null {
  const old = draft.permits.find((item) => item.id === oldPermitId);
  if (!old || !['rejected', 'withdrawn'].includes(old.status)) return null;
  old.status = 'withdrawn';
  old.events.push(permitEvent('superseded', input.author, input.authorRole, '依据反馈修改后重新提交，原记录归档'));
  return createPermit(draft, input);
}

/** 当前生效（含已批准待开始/进行中）的许可，供 UI 徽标使用 */
export function permitsForStep(permits: DeviationPermit[], stepId: string): DeviationPermit[] {
  return permits.filter((permit) => permit.stepId === stepId);
}

export function hasMissingSafety(step: ProcessStep): boolean {
  return step.hazards.length > 0 && (!step.controls.trim() || !step.safetyNote.trim());
}

/** 冻结前检查：不允许存在拦截状态或待审许可 */
export function openPermitBlockers(permits: DeviationPermit[], atIso: string): DeviationPermit[] {
  return permits.filter((permit) =>
    ['pending', 'rejected', 'expired', 'revoked', 'invalidated'].includes(permit.status) ||
    (permit.status === 'approved' && (atIso < permit.startTime || atIso >= permit.endTime))
  );
}

/** 生效许可对某字段是否产生覆盖（编辑器展示临时值徽标） */
export function activeOverride(
  permits: DeviationPermit[],
  stepId: string,
  field: DeviableField,
  atIso: string
): DeviationField | undefined {
  return activePermitFor(permits, stepId, atIso)?.fields.find((change) => change.field === field);
}

export function formatWindow(permit: DeviationPermit): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `${fmt(permit.startTime)} ～ ${fmt(permit.endTime)}`;
}
