export type StepStatus = 'draft' | 'submitted' | 'confirmed' | 'returned' | 'invalidated';
export type ProcessStatus = 'draft' | 'in-review' | 'frozen' | 'revising';
export type ViewId = 'editor' | 'review' | 'deviations' | 'compare';

export interface ReviewComment {
  id: string;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface ProcessStep {
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
}

/** 偏离许可字段变更：保存原值与临时值 */
export interface DeviationField {
  field: DeviableField;
  originalValue: string;
  temporaryValue: string;
}

export type PermitStatus =
  | 'pending'      // 待审
  | 'rejected'     // 未通过
  | 'approved'     // 已批准（生效窗口内）
  | 'expired'      // 已到期（临时值已撤回，待复核人同意恢复）
  | 'revoked'      // 已撤销
  | 'invalidated'  // 被改字段漂移，许可自动失效
  | 'restored'     // 复核人同意恢复，流程关闭
  | 'withdrawn';   // 申请人撤回

export interface PermitAuditEvent {
  id: string;
  at: string;
  actor: string;
  role: string;
  action:
    | 'created' | 'approved' | 'rejected' | 'expired' | 'revoked'
    | 'invalidated' | 'restored' | 'withdrawn' | 'superseded'
    | 'applied' | 'reverted' | 'cascade';
  note: string;
}

export interface DeviationPermit {
  id: string;
  code: string;
  stepId: string;
  stepTitle: string;
  reason: string;
  compensatingControls: string;
  startTime: string;
  endTime: string;
  fields: DeviationField[];
  status: PermitStatus;
  createdAt: string;
  createdBy: string;
  createdByRole: string;
  decidedAt?: string;
  decidedBy?: string;
  decidedByRole?: string;
  decisionNote?: string;
  reviewNote?: string;
  events: PermitAuditEvent[];
}

export interface VersionSnapshot {
  id: string;
  label: string;
  version: string;
  createdAt: string;
  note: string;
  author: string;
  steps: ProcessStep[];
  /** 版本快照同时留存偏离许可记录 */
  permits?: DeviationPermit[];
}

export interface ExperimentProcess {
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
  /** 全量偏离许可记录（含历史，用于审计追溯） */
  permits: DeviationPermit[];
  frozenAt?: string;
  updatedAt: string;
}

export interface HistoryState {
  past: ExperimentProcess[];
  present: ExperimentProcess;
  future: ExperimentProcess[];
}

export interface DiffItem {
  id: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  detail: string;
}

export type DeviableField =
  | 'title' | 'purpose' | 'materials' | 'equipment' | 'amount'
  | 'duration' | 'hazards' | 'controls' | 'safetyNote' | 'expectedResult';
