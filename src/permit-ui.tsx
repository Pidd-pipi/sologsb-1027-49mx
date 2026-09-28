import { useMemo, useState } from 'react';
import {
  Button,
  Callout,
  Dialog,
  FormGroup,
  HTMLSelect,
  Icon,
  InputGroup,
  Tag,
  TextArea
} from '@blueprintjs/core';
import type { DeviationPermit, DeviableField, ProcessStep } from './types';
import {
  FIELD_LABELS,
  PERMIT_STATUS_INTENT,
  PERMIT_STATUS_LABEL,
  formatWindow,
  serializeField
} from './deviations';

const AUDIT_ACTION_LABEL: Record<string, string> = {
  created: '提交申请',
  approved: '批准生效',
  rejected: '未通过',
  expired: '到期失效',
  revoked: '撤销许可',
  invalidated: '字段漂移失效',
  restored: '同意恢复',
  withdrawn: '撤回申请',
  superseded: '被新申请取代',
  applied: '临时值写入',
  reverted: '恢复原值',
  cascade: '下游重新复核'
};

export function PermitStatusTag({ permit, minimal = false }: { permit: DeviationPermit; minimal?: boolean }) {
  return (
    <Tag minimal={minimal} intent={PERMIT_STATUS_INTENT[permit.status]}>{PERMIT_STATUS_LABEL[permit.status]}</Tag>
  );
}

export function FieldChangeTable({ permit }: { permit: DeviationPermit }) {
  return (
    <div className="permit-field-table">
      <div className="permit-field-head"><span>受影响字段</span><span>原值</span><span>临时值</span></div>
      {permit.fields.map((change) => (
        <div className="permit-field-row" key={change.field}>
          <strong>{FIELD_LABELS[change.field]}</strong>
          <span className="original">{change.originalValue || '（空）'}</span>
          <Icon icon="arrow-right" size={12} />
          <span className="temporary">{change.temporaryValue || '（空）'}</span>
        </div>
      ))}
    </div>
  );
}

export function PermitAuditTimeline({ permit }: { permit: DeviationPermit }) {
  return (
    <div className="permit-timeline">
      {permit.events.map((event) => (
        <article key={event.id}>
          <span className={`dot ${event.action}`}></span>
          <div>
            <header>
              <strong>{AUDIT_ACTION_LABEL[event.action] ?? event.action}</strong>
              <span>{event.actor} · {event.role}</span>
              <time>{new Date(event.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time>
            </header>
            <p>{event.note}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function PermitDetail({
  permit,
  onApprove,
  onReject,
  onRevoke,
  onRestore,
  onWithdraw
}: {
  permit: DeviationPermit;
  onApprove: (id: string, note: string) => void;
  onReject: (id: string, note: string) => void;
  onRevoke: (id: string, note: string) => void;
  onRestore: (id: string, note: string) => void;
  onWithdraw: (id: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="permit-detail">
      <div className="permit-detail-head">
        <div>
          <span className="permit-code">{permit.code}</span>
          <h3>{permit.stepTitle}</h3>
        </div>
        <PermitStatusTag permit={permit} />
      </div>

      <FieldChangeTable permit={permit} />

      <div className="permit-meta-grid">
        <div><span>生效时段</span><strong>{formatWindow(permit)}</strong></div>
        <div><span>申请人</span><strong>{permit.createdBy} · {permit.createdByRole}</strong></div>
        <div className="wide"><span>偏离原因</span><p>{permit.reason}</p></div>
        <div className="wide"><span>补偿性控制措施</span><p>{permit.compensatingControls || '未填写'}</p></div>
        {permit.decidedBy && <div className="wide"><span>复核依据（{permit.decidedBy} · {permit.decidedByRole}）</span><p>{permit.decisionNote || '—'}</p></div>}
        {permit.reviewNote && <div className="wide"><span>当前结论</span><p className="danger-text">{permit.reviewNote}</p></div>}
      </div>

      <div className="permit-actions">
        {permit.status === 'pending' && (
          <>
            <TextArea fill rows={2} placeholder="复核意见：批准依据或退回原因（将写入审计记录）" value={note} onChange={(event) => setNote(event.target.value)} />
            <div className="permit-action-row">
              <Button intent="success" icon="tick" text="批准 · 临时值生效" onClick={() => { onApprove(permit.id, note); setNote(''); }} />
              <Button intent="danger" icon="cross" text="退回 · 不允许执行" onClick={() => { onReject(permit.id, note); setNote(''); }} />
              <Button minimal icon="undo" text="申请人撤回" onClick={() => onWithdraw(permit.id)} />
            </div>
          </>
        )}
        {permit.status === 'approved' && (
          <>
            <TextArea fill rows={2} placeholder="撤销原因（立即恢复原值，确认与下游全部失效）" value={note} onChange={(event) => setNote(event.target.value)} />
            <div className="permit-action-row">
              <Button intent="danger" icon="disable" text="复核人撤销许可" disabled={!note.trim()} onClick={() => { onRevoke(permit.id, note); setNote(''); }} />
            </div>
          </>
        )}
        {['expired', 'revoked', 'invalidated'].includes(permit.status) && (
          <>
            <TextArea fill rows={2} placeholder="同意恢复的核对结论（现场、记录、下游影响已确认）" value={note} onChange={(event) => setNote(event.target.value)} />
            <div className="permit-action-row">
              <Button intent="primary" icon="endorsed" text="复核人同意恢复 · 重新进入复核" disabled={!note.trim()} onClick={() => { onRestore(permit.id, note); setNote(''); }} />
            </div>
          </>
        )}
        {permit.status === 'rejected' && (
          <div className="permit-action-row">
            <Button minimal icon="undo" text="申请人撤回并关闭" onClick={() => onWithdraw(permit.id)} />
          </div>
        )}
        {(permit.status === 'restored' || permit.status === 'withdrawn') && (
          <Callout intent="none" icon="archive">该偏离记录已关闭归档，仅保留审计追溯，不再影响步骤确认。</Callout>
        )}
      </div>

      <div className="permit-audit-heading"><span>AUDIT TRAIL</span><h4>批准依据与失效记录</h4></div>
      <PermitAuditTimeline permit={permit} />
    </div>
  );
}

interface PendingChange {
  field: DeviableField;
  temporaryValue: string;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

export function CreateDeviationDialog({
  isOpen,
  steps,
  initialStepId,
  hasPending,
  onClose,
  onSubmit
}: {
  isOpen: boolean;
  steps: ProcessStep[];
  initialStepId: string;
  hasPending: (stepId: string) => boolean;
  onClose: () => void;
  onSubmit: (input: { stepId: string; reason: string; compensatingControls: string; startTime: string; endTime: string; changes: PendingChange[] }) => void;
}) {
  const [stepId, setStepId] = useState(initialStepId);
  const [changes, setChanges] = useState<PendingChange[]>([]);
  const [reason, setReason] = useState('');
  const [controls, setControls] = useState('');
  const [startTime, setStartTime] = useState(toLocalInput(new Date(Date.now() + 60_000).toISOString()));
  const [endTime, setEndTime] = useState(toLocalInput(new Date(Date.now() + 4 * 3_600_000).toISOString()));

  const step = steps.find((item) => item.id === stepId);
  const fieldOptions = useMemo(() => {
    const all = Object.keys(FIELD_LABELS) as DeviableField[];
    return all.filter((field) => !changes.some((change) => change.field === field));
  }, [changes]);

  const reset = (nextStepId = stepId): void => {
    setStepId(nextStepId);
    setChanges([]);
    setReason('');
    setControls('');
    setStartTime(toLocalInput(new Date(Date.now() + 60_000).toISOString()));
    setEndTime(toLocalInput(new Date(Date.now() + 4 * 3_600_000).toISOString()));
  };

  const addChange = (field: DeviableField): void => {
    if (!field || changes.some((change) => change.field === field)) return;
    setChanges([...changes, { field, temporaryValue: '' }]);
  };
  const updateChange = (index: number, value: string): void => {
    setChanges(changes.map((change, i) => (i === index ? { ...change, temporaryValue: value } : change)));
  };
  const removeChange = (index: number): void => setChanges(changes.filter((_, i) => i !== index));

  const startIso = fromLocalInput(startTime);
  const endIso = fromLocalInput(endTime);
  const endInFuture = endIso > new Date().toISOString();
  const windowValid = Boolean(startTime && endTime && endIso > startIso && endInFuture);
  const changesValid = changes.length > 0 && changes.every((change) =>
    change.temporaryValue.trim() && step && change.temporaryValue.trim() !== serializeField(step, change.field)
  );
  const canSubmit = Boolean(step) && !hasPending(stepId) && reason.trim() && windowValid && changesValid;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      onOpened={() => reset(initialStepId)}
      title="申请临时偏离许可"
      icon="git-commit"
      className="permit-dialog"
    >
      <div className="permit-dialog-body">
        <Callout intent="primary" icon="info-sign" className="permit-dialog-note">
          记录保存后立即进入<strong>待审</strong>：未批准前该步骤不能确认，被申请字段锁定；批准后临时值才写入，到期、撤销或字段被改动时原确认立即失效并触发下游重新复核。
        </Callout>

        <FormGroup label="选择步骤" labelFor="permit-step">
          <HTMLSelect id="permit-step" fill value={stepId} onChange={(event) => reset(event.target.value)}>
            {steps.map((item, index) => (
              <option key={item.id} value={item.id}>{String(index + 1).padStart(2, '0')} · {item.title}</option>
            ))}
          </HTMLSelect>
        </FormGroup>
        {step && hasPending(stepId) && (
          <Callout intent="warning" icon="time" className="permit-dialog-note">该步骤已有待审许可，批准或撤回后才能再次申请。</Callout>
        )}

        <div className="permit-edit-head">
          <span>受影响字段</span>
          <HTMLSelect
            minimal
            value=""
            disabled={!fieldOptions.length}
            onChange={(event) => addChange(event.target.value as DeviableField)}
          >
            <option value="">+ 添加字段…</option>
            {fieldOptions.map((field) => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}
          </HTMLSelect>
        </div>
        {step && changes.map((change, index) => (
          <div className="permit-edit-row" key={change.field}>
            <Tag minimal intent="primary" large>{FIELD_LABELS[change.field]}</Tag>
            <div className="permit-edit-values">
              <div><span>原值（自动保存）</span><InputGroup readOnly value={serializeField(step, change.field) || '（空）'} /></div>
              <div><span>临时值</span>
                {change.field === 'hazards' || change.field === 'controls' || change.field === 'safetyNote' || change.field === 'purpose' || change.field === 'expectedResult' || change.field === 'materials' || change.field === 'equipment' || change.field === 'amount' ? (
                  <TextArea fill rows={2} value={change.temporaryValue} onChange={(event) => updateChange(index, event.target.value)} placeholder="批准前不会写入步骤" />
                ) : (
                  <InputGroup fill value={change.temporaryValue} onChange={(event) => updateChange(index, event.target.value)} placeholder="批准前不会写入步骤" />
                )}
              </div>
            </div>
            <Button minimal icon="small-cross" intent="danger" onClick={() => removeChange(index)} aria-label="移除字段" />
          </div>
        ))}
        {!changes.length && <p className="muted">至少选择一个受影响字段；原值在提交时自动快照保存。</p>}

        <FormGroup label="偏离原因" labelFor="permit-reason">
          <TextArea id="permit-reason" fill rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="如：供应商临时换料、设备故障代用、现场窗口受限等具体依据" />
        </FormGroup>
        <FormGroup label="补偿性控制措施" labelFor="permit-controls" helperText="放宽或替换原有控制时必须写明加严的临时措施。">
          <TextArea id="permit-controls" fill rows={2} value={controls} onChange={(event) => setControls(event.target.value)} placeholder="如：全程旁站、缩短监测间隔、增加报警与防护用品等" />
        </FormGroup>
        <div className="permit-window-grid">
          <FormGroup label="生效开始" labelFor="permit-start">
            <InputGroup id="permit-start" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </FormGroup>
          <FormGroup label="生效截止" labelFor="permit-end" helperText={windowValid ? '到期后临时值自动撤回、确认立即失效' : '截止时间必须晚于开始时间，且为未来时刻'}>
            <InputGroup id="permit-end" type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} intent={windowValid ? 'none' : 'danger'} />
          </FormGroup>
        </div>
      </div>
      <div className="permit-dialog-footer">
        <Button text="取消" onClick={onClose} />
        <Button
          intent="primary"
          icon="git-commit"
          text="保存为待审记录"
          disabled={!canSubmit}
          onClick={() => {
            onSubmit({ stepId, reason, compensatingControls: controls, startTime: startIso, endTime: endIso, changes });
            onClose();
          }}
        />
      </div>
    </Dialog>
  );
}
