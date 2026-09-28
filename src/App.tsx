import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
import type {
  DeviableField,
  DeviationPermit,
  DiffItem,
  ExperimentProcess,
  HistoryState,
  ProcessStep,
  StepStatus,
  ViewId
} from './types';
import {
  FIELD_LABELS,
  PERMIT_STATUS_LABEL,
  STEP_STATUS_LABEL,
  activePermitFor,
  blockingPermitFor,
  collectDownstreamIds,
  createPermit,
  hasMissingSafety,
  isStepPermitPending,
  lockedFieldsForStep,
  openPermitBlockers,
  parseListInput,
  permitsForStep,
  reconcilePermits,
  rejectPermit,
  restorePermit,
  revokePermit,
  approvePermit,
  withdrawPermit
} from './deviations';
import { CreateDeviationDialog, FieldChangeTable, PermitDetail, PermitStatusTag } from './permit-ui';

const STORAGE_KEY = 'sologsb-1027-lab-safety-v2';
const LEGACY_STORAGE_KEY = 'sologsb-1027-lab-safety-v1';
const CURRENT_AUTHOR = '周宁';
const CURRENT_ROLE = '安全复核员';
const RESEARCHER_NAME = '李明';
const RESEARCHER_ROLE = '研究员';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isoLocalPlus(days: number, hour: number, minute = 0): string {
  return new Date(2026, 8, 28 + days, hour, minute).toISOString(); // 月份从 0 起，8 = 9 月
}

function seedPermits(): DeviationPermit[] {
  return [
    {
      id: 'permit-seed-1', code: 'DEV-001', stepId: 'step-2', stepTitle: '搭建恒温循环装置',
      reason: '原规格硅胶管临时缺货，采购同内径耐温 PTFE 软管替代，需在下次投料前完成验证。',
      compensatingControls: '将试压时间由 5 分钟延长至 15 分钟，复核员旁站确认无渗漏后方可升温。',
      startTime: isoLocalPlus(-1, 8, 0), endTime: isoLocalPlus(0, 23, 59),
      fields: [{ field: 'equipment', originalValue: '恒温循环浴、硅胶管、反应夹套、扎带', temporaryValue: '恒温循环浴、耐温 PTFE 软管、反应夹套、扎带' }],
      status: 'approved', createdAt: isoLocalPlus(-1, 7, 40), createdBy: RESEARCHER_NAME, createdByRole: RESEARCHER_ROLE,
      decidedAt: isoLocalPlus(-1, 7, 55), decidedBy: CURRENT_AUTHOR, decidedByRole: CURRENT_ROLE,
      decisionNote: 'PTFE 软管耐温与相容性满足 55 ℃ 工况，批准半天窗口，要求延长试压并旁站。',
      events: [
        { id: 'e1-1', at: isoLocalPlus(-1, 7, 40), actor: RESEARCHER_NAME, role: RESEARCHER_ROLE, action: 'created', note: '申请 1 个字段临时偏离，等待复核批准' },
        { id: 'e1-2', at: isoLocalPlus(-1, 7, 55), actor: CURRENT_AUTHOR, role: CURRENT_ROLE, action: 'approved', note: '批准偏离，临时值生效' },
        { id: 'e1-3', at: isoLocalPlus(-1, 7, 55), actor: CURRENT_AUTHOR, role: CURRENT_ROLE, action: 'applied', note: '临时值写入步骤字段' }
      ]
    },
    {
      id: 'permit-seed-2', code: 'DEV-002', stepId: 'step-4', stepTitle: '恒温反应与过程取样',
      reason: '气相色谱进样口维护，前两个取样点改用快速滴定判断转化，仪器恢复后补测留存。',
      compensatingControls: '滴定样双人读数，取样间隔不变，补测结果与滴定偏差超过 2% 时暂停并上报。',
      startTime: isoLocalPlus(0, 9, 0), endTime: isoLocalPlus(0, 18, 0),
      fields: [{ field: 'controls', originalValue: '取样前泄压；使用长针和防护屏；样品瓶及时封闭。', temporaryValue: '取样前泄压；使用长针和防护屏；样品瓶及时封闭；前两点双人滴定读数并留样补测。' }],
      status: 'pending', createdAt: isoLocalPlus(0, 8, 20), createdBy: RESEARCHER_NAME, createdByRole: RESEARCHER_ROLE,
      events: [
        { id: 'e2-1', at: isoLocalPlus(0, 8, 20), actor: RESEARCHER_NAME, role: RESEARCHER_ROLE, action: 'created', note: '申请 1 个字段临时偏离，等待复核批准' }
      ]
    },
    {
      id: 'permit-seed-3', code: 'DEV-003', stepId: 'step-5', stepTitle: '停止加热并冷却',
      reason: '当班冷媒不足，前次实验临时改用自然冷却，超出许可窗口后未恢复。',
      compensatingControls: '（已到期）临时延长搅拌并持续监测温度。',
      startTime: isoLocalPlus(-2, 14, 0), endTime: isoLocalPlus(-1, 18, 0),
      fields: [{ field: 'controls', originalValue: '先停止加料并维持搅拌，再以不超过 1 ℃/min 的速率降温。', temporaryValue: '先停止加料并维持搅拌，冷媒不足期间改为自然冷却，每 5 分钟记录温度。' }],
      status: 'expired', createdAt: isoLocalPlus(-2, 13, 40), createdBy: RESEARCHER_NAME, createdByRole: RESEARCHER_ROLE,
      decidedAt: isoLocalPlus(-2, 13, 50), decidedBy: CURRENT_AUTHOR, decidedByRole: CURRENT_ROLE,
      decisionNote: '仅限当日冷媒补给前使用，次日 18:00 前必须恢复程序降温。',
      reviewNote: '生效时段已结束，临时值自动撤回；需复核人同意恢复后方可重新确认。',
      events: [
        { id: 'e3-1', at: isoLocalPlus(-2, 13, 40), actor: RESEARCHER_NAME, role: RESEARCHER_ROLE, action: 'created', note: '申请 1 个字段临时偏离，等待复核批准' },
        { id: 'e3-2', at: isoLocalPlus(-2, 13, 50), actor: CURRENT_AUTHOR, role: CURRENT_ROLE, action: 'approved', note: '批准偏离，临时值生效' },
        { id: 'e3-3', at: isoLocalPlus(-2, 13, 50), actor: CURRENT_AUTHOR, role: CURRENT_ROLE, action: 'applied', note: '临时值写入步骤字段' },
        { id: 'e3-4', at: isoLocalPlus(-1, 18, 0), actor: '系统', role: '自动校验', action: 'expired', note: '生效时段到期，许可自动失效' },
        { id: 'e3-5', at: isoLocalPlus(-1, 18, 0), actor: '系统', role: '自动校验', action: 'reverted', note: '临时值恢复为许可前原值' }
      ]
    }
  ];
}

function applySeedPermits(steps: ProcessStep[], permits: DeviationPermit[]): void {
  permits.forEach((permit) => {
    const step = steps.find((item) => item.id === permit.stepId);
    if (!step) return;
    if (permit.status === 'approved') {
      permit.fields.forEach((change) => {
        const key = change.field;
        if (key === 'hazards') (step as unknown as Record<string, unknown>).hazards = parseListInput(change.temporaryValue);
        else if (key === 'duration') (step as unknown as Record<string, unknown>).duration = Number(change.temporaryValue) || 0;
        else (step as unknown as Record<string, unknown>)[key] = change.temporaryValue;
      });
    }
    if (permit.status === 'expired') step.status = 'invalidated';
    if (permit.status === 'pending' && step.status === 'confirmed') step.status = 'submitted';
  });
}

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
      materials: '无', equipment: '恒温循环浴、耐温 PTFE 软管、反应夹套、扎带', amount: '循环液 800 mL',
      duration: 25, hazards: ['烫伤', '管路脱落'], controls: '管路双端固定；升温前完成 5 分钟试压并设置独立超温断电。',
      dependencies: ['step-1'], safetyNote: '高温表面设置警示标识，循环浴周围保持干燥。', expectedResult: '30 分钟内温度稳定在 55 ± 0.5 ℃。',
      status: 'submitted', comments: [
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
      status: 'invalidated', comments: []
    },
    {
      id: 'step-6', title: '废液分类与现场恢复', purpose: '按危险废物要求分类收集并恢复实验区域。',
      materials: '废液桶、吸附棉', equipment: '防化手套、护目镜、危废标签', amount: '按实际产生量记录', duration: 25,
      hazards: ['废液混装', '化学暴露'], controls: '有机废液单独收集，核对相容性后贴标签；泄漏吸附材料按危废处置。',
      dependencies: ['step-5'], safetyNote: '废液不得倒入下水道，现场恢复后完成双人确认。', expectedResult: '废液交接记录完整，台面无残留。',
      status: 'draft', comments: []
    }
  ];

  const firstVersion: ExperimentProcess['versions'][number] = {
    id: 'version-1-0', label: '首版批准流程', version: '1.0.0', createdAt: '2026-09-20T14:30:00+08:00',
    note: '建立基础反应与取样步骤。', author: '王颖',
    steps: clone(baseSteps).slice(0, 4).map((step) => ({ ...step, status: 'confirmed' as StepStatus, comments: [] })),
    permits: []
  };
  const secondVersion: ExperimentProcess['versions'][number] = {
    id: 'version-1-1', label: '补充冷却与废液步骤', version: '1.1.0', createdAt: '2026-09-24T15:10:00+08:00',
    note: '增加安全冷却、废液处置和现场恢复。', author: '王颖',
    steps: clone(baseSteps).map((step) => ({ ...step, status: 'confirmed' as StepStatus, comments: [] })),
    permits: []
  };

  const permits = seedPermits();
  applySeedPermits(baseSteps, permits);

  return {
    id: 'exp-catalyst-2026-09', title: '负载型催化剂评价实验', code: 'SAFE-CAT-026',
    objective: '在受控温度下评价催化剂活性，并完整记录过程样品与安全记录。',
    principal: '李明', lab: '材料化学实验室 B-207',
    status: 'in-review', version: '1.2.0-draft',
    steps: baseSteps, versions: [firstVersion, secondVersion], permits,
    updatedAt: new Date().toISOString()
  };
}

function historyReducer(state: HistoryState, action:
  | { type: 'commit'; update: (draft: ExperimentProcess) => void; at: string }
  | { type: 'tick'; at: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: ExperimentProcess }
): HistoryState {
  if (action.type === 'commit') {
    const next = clone(state.present);
    action.update(next);
    reconcilePermits(next, action.at);
    next.updatedAt = action.at;
    return { past: [...state.past.slice(-59), clone(state.present)], present: next, future: [] };
  }
  if (action.type === 'tick') {
    const next = clone(state.present);
    const beforeEvents = next.permits.reduce((sum, permit) => sum + permit.events.length, 0);
    reconcilePermits(next, action.at);
    const afterEvents = next.permits.reduce((sum, permit) => sum + permit.events.length, 0);
    // 仅当确有到期/漂移发生时才替换 present（不进入撤销栈），保证重开页面/长时间停留都能即时拦截
    return afterEvents === beforeEvents && JSON.stringify(next) === JSON.stringify(state.present)
      ? state
      : { past: state.past, present: next, future: state.future };
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
  return { past: [], present: action.value, future: [] };
}

function loadProcess(): ExperimentProcess {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return initialProcess();
    const parsed = JSON.parse(raw) as ExperimentProcess;
    if (!parsed.id || !Array.isArray(parsed.steps)) return initialProcess();
    if (!Array.isArray(parsed.permits)) parsed.permits = [];
    parsed.versions.forEach((version) => { if (!Array.isArray(version.permits)) version.permits = []; });
    return parsed;
  } catch {
    return initialProcess();
  }
}

function splitList(value: string): string[] {
  return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

function statusLabel(status: StepStatus): string {
  return STEP_STATUS_LABEL[status];
}

function processStatusLabel(status: ExperimentProcess['status']): string {
  return status === 'frozen' ? '已冻结' : status === 'in-review' ? '复核中' : status === 'revising' ? '修订中' : '草稿';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => {
    const loaded = loadProcess();
    // 重开页面后先做一次状态协调（过期许可、字段漂移），并立即落盘，保证到期/失效记录留下
    reconcilePermits(loaded, new Date().toISOString());
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded)); } catch { /* 存储不可用时忽略 */ }
    return { past: [] as ExperimentProcess[], present: loaded, future: [] as ExperimentProcess[] };
  });
  const process = history.present;
  const [selectedStepId, setSelectedStepId] = useState(process.steps[0]?.id ?? '');
  const [activeView, setActiveView] = useState<ViewId>('editor');
  const [lastModifiedId, setLastModifiedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [savedLabel, setSavedLabel] = useState('本地数据已载入');
  const [online, setOnline] = useState(true);
  const [compareBaseId, setCompareBaseId] = useState(process.versions[0]?.id ?? '');
  const [compareTargetId, setCompareTargetId] = useState(process.versions.at(-1)?.id ?? '');
  const [permitDialogOpen, setPermitDialogOpen] = useState(false);
  const [selectedPermitId, setSelectedPermitId] = useState<string | null>(process.permits.at(-1)?.id ?? null);
  const [clockIso, setClockIso] = useState(new Date().toISOString());
  const initialSaveSkipped = useRef(false);

  const selectedStep = process.steps.find((step) => step.id === selectedStepId) ?? process.steps[0];
  const downstreamIds = useMemo(() => (lastModifiedId ? collectDownstreamIds(process.steps, lastModifiedId) : []), [process.steps, lastModifiedId]);
  const impactedSteps = process.steps.filter((step) => downstreamIds.includes(step.id));
  const missingSafetySteps = process.steps.filter(hasMissingSafety);
  const pendingReviewCount = process.steps.filter((step) => step.status === 'submitted' || step.status === 'returned' || step.status === 'invalidated').length;
  const confirmedCount = process.steps.filter((step) => step.status === 'confirmed').length;
  const reviewProgress = process.steps.length ? Math.round((confirmedCount / process.steps.length) * 100) : 0;
  const versionDiff = useMemo(() => compareVersions(process, compareBaseId, compareTargetId), [process, compareBaseId, compareTargetId]);

  const pendingPermits = process.permits.filter((permit) => permit.status === 'pending');
  const blockerPermits = openPermitBlockers(process.permits, clockIso);
  const selectedPermit = process.permits.find((permit) => permit.id === selectedPermitId) ?? null;

  // 每 20 秒协调一次到期/漂移；重开页面已在初始化时协调
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date().toISOString();
      setClockIso(now);
      dispatch({ type: 'tick', at: now });
    }, 20_000);
    return () => window.clearInterval(timer);
  }, []);

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
    dispatch({ type: 'commit', update, at: new Date().toISOString() });
  };

  const updateProcessField = (field: 'title' | 'code' | 'objective' | 'principal' | 'lab', value: string): void => {
    commitProcess((draft) => { draft[field] = value; });
  };

  const updateStep = (field: keyof ProcessStep, value: unknown): void => {
    if (!selectedStep) return;
    const id = selectedStep.id;
    setLastModifiedId(id);
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      if (step) (step as unknown as Record<string, unknown>)[field] = value;
    });
  };

  const updateStepList = (field: 'hazards' | 'dependencies', value: string): void => {
    updateStep(field, splitList(value));
  };

  const lockedFields = selectedStep ? lockedFieldsForStep(process.permits, selectedStep.id) : new Set<DeviableField>();
  const fieldLocked = (field: DeviableField): boolean => lockedFields.has(field);
  const isFieldReadOnly = (field: DeviableField): boolean =>
    process.status === 'frozen' || fieldLocked(field);
  const activePermit = selectedStep ? activePermitFor(process.permits, selectedStep.id, clockIso) : undefined;
  const activeOverrideFor = (field: DeviableField) =>
    activePermit?.fields.find((change) => change.field === field);
  const stepBlockingPermit = selectedStep ? blockingPermitFor(process.permits, selectedStep.id, clockIso) : undefined;

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

  /** 确认闸门：存在拦截许可（待审/未通过/过期/撤销/漂移失效）或安全缺口时不能确认 */
  const canConfirmStep = Boolean(selectedStep) && !hasMissingSafety(selectedStep) && !stepBlockingPermit;

  const freezeVersion = (): void => {
    if (process.status === 'frozen') return;
    if (process.steps.some((step) => step.status !== 'confirmed') || missingSafetySteps.length || openPermitBlockers(process.permits, new Date().toISOString()).length) {
      setSavedLabel('冻结条件未满足');
      return;
    }
    const nextNumber = nextMinorVersion(process.version);
    const previousVersionId = process.versions.at(-1)?.id ?? '';
    const frozenVersionId = uid('version');
    commitProcess((draft) => {
      draft.versions.push({
        id: frozenVersionId, label: '复核通过冻结版', version: nextNumber,
        createdAt: new Date().toISOString(), note: `${draft.steps.length} 个步骤全部确认，安全控制完整，偏离许可记录随版留存。`,
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
    setSavedLabel('已保存工作版本快照');
  };

  // ---- 偏离许可操作 ----
  const submitPermitRequest = (input: {
    stepId: string; reason: string; compensatingControls: string;
    startTime: string; endTime: string;
    changes: { field: DeviableField; temporaryValue: string }[];
  }): void => {
    const newPermitId = uid('permit');
    commitProcess((draft) => {
      createPermit(draft, { ...input, id: newPermitId, author: RESEARCHER_NAME, authorRole: RESEARCHER_ROLE });
    });
    setSelectedPermitId(newPermitId);
    setSelectedStepId(input.stepId);
    setSavedLabel('偏离许可已保存为待审');
    setActiveView('deviations');
  };

  const approveSelected = (id: string, note: string): void => {
    commitProcess((draft) => approvePermit(draft, id, CURRENT_AUTHOR, CURRENT_ROLE, note));
    const permit = process.permits.find((item) => item.id === id);
    if (permit) { setSelectedStepId(permit.stepId); setLastModifiedId(permit.stepId); }
    setSavedLabel('偏离已批准，临时值生效，步骤与下游重新复核');
  };
  const rejectSelected = (id: string, note: string): void => {
    commitProcess((draft) => rejectPermit(draft, id, CURRENT_AUTHOR, CURRENT_ROLE, note));
    setSavedLabel('偏离未通过，该步骤不能确认');
  };
  const revokeSelected = (id: string, note: string): void => {
    commitProcess((draft) => revokePermit(draft, id, CURRENT_AUTHOR, CURRENT_ROLE, note));
    setSavedLabel('许可已撤销，原值恢复，确认与下游已失效');
  };
  const restoreSelected = (id: string, note: string): void => {
    commitProcess((draft) => restorePermit(draft, id, CURRENT_AUTHOR, CURRENT_ROLE, note));
    setSavedLabel('复核人已同意恢复，步骤重新进入复核队列');
  };
  const withdrawSelected = (id: string): void => {
    commitProcess((draft) => withdrawPermit(draft, id, RESEARCHER_NAME, RESEARCHER_ROLE));
    setSavedLabel('偏离申请已撤回');
  };

  const hasPendingOn = (stepId: string): boolean => isStepPermitPending(process.permits, stepId);

  const renderFieldBadge = (field: DeviableField) => {
    const override = activeOverrideFor(field);
    if (override) {
      return (
        <Tag minimal intent="success" className="field-deviation-tag" icon="git-commit">
          临时值 · 许可 {activePermit?.code}
        </Tag>
      );
    }
    return null;
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-icon"><Icon icon="lab-test" size={23} /></div>
          <div><h1>实验流程安全复核台</h1><p>偏离许可 · 步骤影响分析 · 逐条复核 · 冻结版本</p></div>
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
          <small>{pendingReviewCount ? `${pendingReviewCount} 条待处理` : '所有步骤已处理'} · {missingSafetySteps.length} 条安全缺口 · {pendingPermits.length} 份偏离待审</small>
        </div>
      </section>

      <Tabs id="workspace-tabs" selectedTabId={activeView} onChange={(value) => setActiveView(value as ViewId)} renderActiveTabPanelOnly className="workspace-tabs">
        <Tab id="editor" title={<span><Icon icon="edit" /> 流程编写</span>} />
        <Tab id="review" title={<span><Icon icon="endorsed" /> 安全复核 {pendingReviewCount > 0 && <b className="tab-badge">{pendingReviewCount}</b>}</span>} />
        <Tab id="deviations" title={<span><Icon icon="git-commit" /> 偏离许可 {pendingPermits.length > 0 && <b className="tab-badge">{pendingPermits.length}</b>}</span>} />
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
              {process.steps.map((step, index) => {
                const permit = activePermitFor(process.permits, step.id, clockIso);
                const blocker = blockingPermitFor(process.permits, step.id, clockIso);
                return (
                  <button key={step.id} className={step.id === selectedStep.id ? 'selected' : ''} onClick={() => setSelectedStepId(step.id)}>
                    <span className={`step-number ${step.status}`}>{String(index + 1).padStart(2, '0')}</span>
                    <span className="step-copy">
                      <strong>{step.title}</strong>
                      <small>{step.duration} 分钟 · {statusLabel(step.status)}{permit ? ' · 偏离生效' : blocker ? ' · 偏离拦截' : ''}</small>
                    </span>
                    {permit ? <Icon icon="git-commit" intent="success" size={13} /> : blocker ? <Icon icon="lock" intent="warning" size={13} /> : hasMissingSafety(step) ? <Icon icon="warning-sign" intent="danger" size={13} /> : null}
                  </button>
                );
              })}
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

            {stepBlockingPermit && (
              <Callout intent="warning" icon="lock" className="step-permit-banner">
                <strong>该步骤当前不能确认：偏离许可 {stepBlockingPermit.code} 为「{PERMIT_STATUS_LABEL[stepBlockingPermit.status]}」</strong>
                <p>待审通过前、未通过、已到期、被撤销或字段漂移失效期间，确认操作保持锁定；请在「偏离许可」页查看依据与失效时间，或由复核人同意恢复。</p>
                <Button small minimal icon="git-commit" text="查看许可记录" onClick={() => { setSelectedPermitId(stepBlockingPermit.id); setActiveView('deviations'); }} />
              </Callout>
            )}
            {activePermit && (
              <Callout intent="success" icon="git-commit" className="step-permit-banner">
                <strong>偏离许可 {activePermit.code} 生效中：以下字段显示临时值</strong>
                <p>生效时段 {formatWindowShort(activePermit)}；到期、撤销或修改被许可字段时，原确认立即失效，下游重新复核。</p>
                <FieldChangeTable permit={activePermit} />
              </Callout>
            )}

            <Card elevation={Elevation.ONE} className="step-editor-card">
              <div className="card-title">
                <div><span>STEP {String(process.steps.indexOf(selectedStep) + 1).padStart(2, '0')}</span><h3>{selectedStep.title}</h3></div>
                <Tag minimal intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' || selectedStep.status === 'invalidated' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag>
              </div>
              <FormGroup label={<LabelWithTag text="步骤名称" tag={renderFieldBadge('title')} />} labelFor="step-title"><InputGroup id="step-title" fill readOnly={isFieldReadOnly('title')} value={selectedStep.title} onChange={(event) => updateStep('title', event.target.value)} /></FormGroup>
              <FormGroup label={<LabelWithTag text="操作目的" tag={renderFieldBadge('purpose')} />} labelFor="step-purpose"><TextArea id="step-purpose" fill readOnly={isFieldReadOnly('purpose')} value={selectedStep.purpose} onChange={(event) => updateStep('purpose', event.target.value)} /></FormGroup>
              <div className="form-grid">
                <FormGroup label={<LabelWithTag text="材料" tag={renderFieldBadge('materials')} />} labelFor="materials"><TextArea id="materials" fill readOnly={isFieldReadOnly('materials')} value={selectedStep.materials} onChange={(event) => updateStep('materials', event.target.value)} /></FormGroup>
                <FormGroup label={<LabelWithTag text="设备" tag={renderFieldBadge('equipment')} />} labelFor="equipment"><TextArea id="equipment" fill readOnly={isFieldReadOnly('equipment')} value={selectedStep.equipment} onChange={(event) => updateStep('equipment', event.target.value)} /></FormGroup>
                <FormGroup label={<LabelWithTag text="用量 / 参数" tag={renderFieldBadge('amount')} />} labelFor="amount"><TextArea id="amount" fill readOnly={isFieldReadOnly('amount')} value={selectedStep.amount} onChange={(event) => updateStep('amount', event.target.value)} /></FormGroup>
                <FormGroup label={<LabelWithTag text="预计时间（分钟）" tag={renderFieldBadge('duration')} />} labelFor="duration"><InputGroup id="duration" type="number" min={1} fill readOnly={isFieldReadOnly('duration')} value={String(selectedStep.duration)} onChange={(event) => updateStep('duration', Number(event.target.value))} /></FormGroup>
              </div>
              <div className="form-grid two-column">
                <FormGroup label={<LabelWithTag text="危险项（逗号或换行分隔）" tag={renderFieldBadge('hazards')} />} labelFor="hazards"><TextArea id="hazards" fill readOnly={isFieldReadOnly('hazards')} value={selectedStep.hazards.join('，')} onChange={(event) => updateStepList('hazards', event.target.value)} /></FormGroup>
                <FormGroup label={<LabelWithTag text="控制措施" tag={renderFieldBadge('controls')} />} labelFor="controls"><TextArea id="controls" fill readOnly={isFieldReadOnly('controls')} value={selectedStep.controls} onChange={(event) => updateStep('controls', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label={<LabelWithTag text="安全说明" tag={renderFieldBadge('safetyNote')} />} labelFor="safety-note" helperText={hasMissingSafety(selectedStep) ? '存在危险项时，控制措施和安全说明均为必填。' : '安全说明已满足复核条件。'}>
                <TextArea id="safety-note" fill intent={hasMissingSafety(selectedStep) ? 'danger' : 'none'} readOnly={isFieldReadOnly('safetyNote')} value={selectedStep.safetyNote} onChange={(event) => updateStep('safetyNote', event.target.value)} />
              </FormGroup>
              <FormGroup label={<LabelWithTag text="预期结果" tag={renderFieldBadge('expectedResult')} />} labelFor="expected"><TextArea id="expected" fill readOnly={isFieldReadOnly('expectedResult')} value={selectedStep.expectedResult} onChange={(event) => updateStep('expectedResult', event.target.value)} /></FormGroup>
              {lockedFields.size > 0 && (
                <Callout intent="primary" icon="time" className="lock-hint">
                  {[...lockedFields].map((field) => FIELD_LABELS[field]).join('、')} 已纳入待审偏离申请，批准前锁定；申请记录中保存了原值与临时值。
                </Callout>
              )}
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

            <Card elevation={Elevation.ONE} className="step-permit-card">
              <div className="card-title">
                <div><span>DEVIATION PERMITS</span><h3>本步骤偏离许可</h3></div>
                <Button icon="git-commit" small intent="primary" text="申请临时偏离" disabled={process.status === 'frozen' || hasPendingOn(selectedStep.id)} onClick={() => setPermitDialogOpen(true)} />
              </div>
              {permitsForStep(process.permits, selectedStep.id).length === 0 && (
                <p className="muted">临时换料、放宽控制时不得直接改步骤；先申请偏离许可，记录原值、临时值、原因、补偿措施与生效时段。</p>
              )}
              <div className="step-permit-list">
                {permitsForStep(process.permits, selectedStep.id).map((permit) => (
                  <button key={permit.id} onClick={() => { setSelectedPermitId(permit.id); setActiveView('deviations'); }}>
                    <span className="permit-code">{permit.code}</span>
                    <span className="permit-fields">{permit.fields.map((change) => FIELD_LABELS[change.field]).join('、')}</span>
                    <PermitStatusTag permit={permit} minimal />
                    <Icon icon="chevron-right" size={12} />
                  </button>
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
              ) : <p className="muted">编辑任一步骤后，这里会显示受影响的所有后续步骤和已确认内容。偏离许可生效、到期或撤销同样会触发下游重新复核。</p>}
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
              <div className="gate-row"><span>偏离待审 / 拦截</span><strong className={pendingPermits.length || blockerPermits.length ? 'danger-text' : ''}>{pendingPermits.length} / {blockerPermits.length}</strong></div>
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
            {process.steps.map((step, index) => {
              const blocker = blockingPermitFor(process.permits, step.id, clockIso);
              const active = activePermitFor(process.permits, step.id, clockIso);
              return (
                <button key={step.id} className={`${step.id === selectedStep.id ? 'selected' : ''} ${step.status}`} onClick={() => setSelectedStepId(step.id)}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{step.title}</strong><small>{statusLabel(step.status)}{blocker ? ' · 偏离拦截' : active ? ' · 临时值生效' : ''}</small></div>
                  <Icon icon={step.status === 'confirmed' ? 'tick-circle' : step.status === 'returned' || step.status === 'invalidated' ? 'undo' : blocker ? 'lock' : 'circle'} intent={blocker ? 'warning' : 'none'} size={15} />
                </button>
              );
            })}
          </aside>
          <section className="review-main">
            {selectedStep && (
              <>
                {permitsForStep(process.permits, selectedStep.id).filter((permit) => !['restored', 'withdrawn'].includes(permit.status)).map((permit) => (
                  <Card key={permit.id} elevation={Elevation.ONE} className="review-permit-card">
                    <div className="card-title">
                      <div><span>DEVIATION {permit.code}</span><h3>临时偏离许可</h3></div>
                      <PermitStatusTag permit={permit} />
                    </div>
                    <p className="permit-window-line">生效时段：{formatWindowShort(permit)} · 申请人 {permit.createdBy}</p>
                    <FieldChangeTable permit={permit} />
                    <div className="review-permit-reason"><strong>偏离原因</strong><p>{permit.reason}</p><strong>补偿性控制措施</strong><p>{permit.compensatingControls || '未填写'}</p></div>
                    <Button minimal small icon="git-commit" text="在偏离许可页处理" onClick={() => { setSelectedPermitId(permit.id); setActiveView('deviations'); }} />
                  </Card>
                ))}
                <Card elevation={Elevation.ONE} className="review-summary">
                  <div className="card-title"><div><span>SAFETY REVIEW</span><h3>{selectedStep.title}</h3></div><Tag intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' || selectedStep.status === 'invalidated' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag></div>
                  {stepBlockingPermit && (
                    <Callout intent="warning" icon="lock">
                      <strong>确认已锁定：许可 {stepBlockingPermit.code} 处于「{PERMIT_STATUS_LABEL[stepBlockingPermit.status]}」</strong>
                      <p>待审通过、到期/撤销/漂移后由复核人同意恢复，方可再次确认本步骤。</p>
                    </Callout>
                  )}
                  {activePermit && (
                    <Callout intent="success" icon="git-commit">
                      <strong>按许可 {activePermit.code} 的临时值复核中（{formatWindowShort(activePermit)}）</strong>
                    </Callout>
                  )}
                  <div className="review-facts">
                    <div><span>预计时间</span><strong>{selectedStep.duration} 分钟</strong></div>
                    <div><span>材料与用量</span><strong>{selectedStep.materials} / {selectedStep.amount}</strong></div>
                    <div><span>危险项</span><strong>{selectedStep.hazards.join('、') || '无'}</strong></div>
                  </div>
                  <div className="review-section"><h4>控制措施</h4><p>{selectedStep.controls || '未填写'}</p></div>
                  <div className="review-section"><h4>安全说明</h4><p className={hasMissingSafety(selectedStep) ? 'danger-text' : ''}>{selectedStep.safetyNote || '未填写'}</p></div>
                  {hasMissingSafety(selectedStep) && <Callout intent="danger" icon="warning-sign">当前步骤存在安全信息缺口，不能确认或冻结版本。</Callout>}
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
              {stepBlockingPermit && (
                <Callout intent="warning" icon="lock" className="confirm-lock-callout">
                  偏离许可 {stepBlockingPermit.code}（{PERMIT_STATUS_LABEL[stepBlockingPermit.status]}）未解除，不能确认本步骤。
                </Callout>
              )}
              <p className="muted">确认后若修改该步骤或许可到期、撤销、字段漂移，受影响的下游步骤会自动重新进入复核。</p>
              <Button fill large intent="success" icon="tick" text="逐条确认" disabled={!canConfirmStep} onClick={() => setStepStatus('confirmed')} />
              <Button fill large icon="undo" text="退回修改" intent="warning" onClick={() => setStepStatus('returned')} />
              <Button fill large minimal icon="refresh" text="恢复为待复核" onClick={() => setStepStatus('submitted')} />
              <Divider />
              <div className="review-progress-list">
                {process.steps.map((step) => <div key={step.id}><span>{step.title}</span><Tag minimal intent={step.status === 'confirmed' ? 'success' : step.status === 'returned' || step.status === 'invalidated' ? 'danger' : 'warning'}>{statusLabel(step.status)}</Tag></div>)}
              </div>
              <Button fill intent="primary" icon="lock" text="全部确认后冻结" onClick={freezeVersion} disabled={process.status === 'frozen'} />
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'deviations' && (
        <main className="permit-layout">
          <Card elevation={Elevation.ONE} className="permit-list-card">
            <div className="card-title">
              <div><span>DEVIATION REGISTER</span><h3>偏离许可台账</h3></div>
              <Button icon="git-commit" small intent="primary" text="申请临时偏离" disabled={process.status === 'frozen'} onClick={() => setPermitDialogOpen(true)} />
            </div>
            <div className="permit-register-summary">
              <div><strong>{pendingPermits.length}</strong><span>待审</span></div>
              <div><strong>{process.permits.filter((permit) => permit.status === 'approved').length}</strong><span>生效中</span></div>
              <div><strong className={blockerPermits.length ? 'danger-text' : ''}>{blockerPermits.length}</strong><span>拦截确认</span></div>
              <div><strong>{process.permits.filter((permit) => ['restored', 'withdrawn'].includes(permit.status)).length}</strong><span>已归档</span></div>
            </div>
            <div className="permit-register">
              {process.permits.slice().reverse().map((permit) => {
                const step = process.steps.find((item) => item.id === permit.stepId);
                return (
                  <button key={permit.id} className={selectedPermitId === permit.id ? 'selected' : ''} onClick={() => setSelectedPermitId(permit.id)}>
                    <div className="permit-register-top">
                      <span className="permit-code">{permit.code}</span>
                      <PermitStatusTag permit={permit} minimal />
                    </div>
                    <strong>{step ? `${String(process.steps.indexOf(step) + 1).padStart(2, '0')} · ` : ''}{permit.stepTitle}</strong>
                    <small>{permit.fields.map((change) => FIELD_LABELS[change.field]).join('、')}</small>
                    <small className="permit-register-window">{formatWindowShort(permit)}</small>
                  </button>
                );
              })}
              {!process.permits.length && <p className="muted">尚无偏离许可记录。</p>}
            </div>
          </Card>

          <Card elevation={Elevation.ONE} className="permit-detail-card">
            {selectedPermit ? (
              <PermitDetail
                permit={selectedPermit}
                onApprove={approveSelected}
                onReject={rejectSelected}
                onRevoke={revokeSelected}
                onRestore={restoreSelected}
                onWithdraw={withdrawSelected}
              />
            ) : (
              <div className="empty-diff"><Icon icon="git-commit" size={30} /><strong>选择左侧许可记录</strong><p>这里展示原值、临时值、原因、控制措施、生效时段与完整审计依据。</p></div>
            )}
          </Card>
        </main>
      )}

      {activeView === 'compare' && (
        <main className="compare-layout">
          <Card elevation={Elevation.ONE} className="version-panel">
            <div className="card-title"><div><span>VERSION TIMELINE</span><h3>冻结版本</h3></div><Tag minimal>{process.versions.length} 个</Tag></div>
            <div className="version-timeline">
              {process.versions.map((version, index) => (
                <article key={version.id} className={index === process.versions.length - 1 ? 'latest' : ''}>
                  <span></span><div><b>{version.version}</b><strong>{version.label}</strong><p>{formatDate(version.createdAt)} · {version.steps.length} 个步骤 · {version.permits?.length ?? 0} 份偏离记录 · {version.author}</p><small>{version.note}</small></div>
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
            <PermitSnapshotDiff process={process} baseId={compareBaseId} targetId={compareTargetId} />
          </Card>
          <Card elevation={Elevation.ONE} className="freeze-rules">
            <div className="card-title"><div><span>FREEZE RULES</span><h3>冻结检查</h3></div></div>
            <div className={confirmedCount === process.steps.length ? 'passed' : ''}><Icon icon={confirmedCount === process.steps.length ? 'tick-circle' : 'circle'} /><span><strong>所有步骤已确认</strong><small>{confirmedCount}/{process.steps.length}</small></span></div>
            <div className={!missingSafetySteps.length ? 'passed' : ''}><Icon icon={!missingSafetySteps.length ? 'tick-circle' : 'circle'} /><span><strong>安全信息完整</strong><small>{missingSafetySteps.length} 个缺口</small></span></div>
            <div className={blockerPermits.length === 0 && pendingPermits.length === 0 ? 'passed' : ''}><Icon icon={blockerPermits.length === 0 && pendingPermits.length === 0 ? 'tick-circle' : 'circle'} /><span><strong>无待审或拦截中的偏离</strong><small>{pendingPermits.length} 待审 · {blockerPermits.length} 拦截</small></span></div>
            <div className={process.steps.every((step) => step.dependencies.every((id) => process.steps.some((item) => item.id === id))) ? 'passed' : ''}><Icon icon="git-merge" /><span><strong>依赖引用有效</strong><small>{process.steps.reduce((sum, step) => sum + step.dependencies.length, 0)} 条依赖</small></span></div>
            <Button fill intent="primary" icon="lock" text="冻结当前版本" onClick={freezeVersion} disabled={process.status === 'frozen' || confirmedCount !== process.steps.length || missingSafetySteps.length > 0 || blockerPermits.length > 0 || pendingPermits.length > 0} />
          </Card>
        </main>
      )}

      <CreateDeviationDialog
        isOpen={permitDialogOpen}
        steps={process.steps}
        initialStepId={selectedStep?.id ?? process.steps[0]?.id ?? ''}
        hasPending={hasPendingOn}
        onClose={() => setPermitDialogOpen(false)}
        onSubmit={submitPermitRequest}
      />

      <footer className="app-footer">
        <span>所有实验数据与偏离许可记录仅保存在当前浏览器 localStorage，版本快照随版留存。</span>
        <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Ctrl/Cmd + S 保存</span>
      </footer>
    </div>
  );

  function resolveComment(commentId: string): void {
    if (!selectedStep) return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const comment = draft.steps.find((step) => step.id === stepId)?.comments.find((item) => item.id === commentId);
      if (comment) comment.resolved = !comment.resolved;
    });
  }
}

function LabelWithTag({ text, tag }: { text: string; tag: ReactNode }) {
  return <span className="bp6-label-text">{text}{tag}</span>;
}

function formatWindowShort(permit: DeviationPermit): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `${fmt(permit.startTime)} ～ ${fmt(permit.endTime)}`;
}

function PermitSnapshotDiff({ process, baseId, targetId }: { process: ExperimentProcess; baseId: string; targetId: string }) {
  const base = process.versions.find((version) => version.id === baseId);
  const target = process.versions.find((version) => version.id === targetId);
  if (!base || !target) return null;
  const basePermits = base.permits ?? [];
  const targetPermits = target.permits ?? [];
  if (!basePermits.length && !targetPermits.length) return null;
  return (
    <div className="permit-snapshot-diff">
      <div className="card-title"><div><span>DEVIATION SNAPSHOT</span><h3>偏离许可快照</h3></div></div>
      <div className="permit-snapshot-grid">
        <div>
          <h4>{base.version} · 基准（{basePermits.length} 份）</h4>
          {basePermits.map((permit) => (
            <div className="permit-snapshot-row" key={permit.id}><span className="permit-code">{permit.code}</span><strong>{permit.stepTitle}</strong><Tag minimal intent="none">{PERMIT_STATUS_LABEL[permit.status]}</Tag></div>
          ))}
          {!basePermits.length && <p className="muted">该版本无偏离记录。</p>}
        </div>
        <div>
          <h4>{target.version} · 目标（{targetPermits.length} 份）</h4>
          {targetPermits.map((permit) => (
            <div className="permit-snapshot-row" key={permit.id}><span className="permit-code">{permit.code}</span><strong>{permit.stepTitle}</strong><Tag minimal intent={permit.status === 'approved' ? 'success' : 'none'}>{PERMIT_STATUS_LABEL[permit.status]}</Tag></div>
          ))}
          {!targetPermits.length && <p className="muted">该版本无偏离记录。</p>}
        </div>
      </div>
    </div>
  );
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
  return diffs;
}

export default App;
