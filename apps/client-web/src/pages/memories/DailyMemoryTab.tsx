import { BookHeart, MapPin, Plus, Trash2 } from "lucide-react";
import type {
  Dispatch,
  FormEventHandler,
  SetStateAction,
} from "react";
import type { AppState, MemoryKind } from "../../domain/types";

export type MemoryForm = {
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string;
};

type Props = {
  state: AppState;
  updateState: (updater: (current: AppState) => AppState) => void;
  memoryForm: MemoryForm;
  setMemoryForm: Dispatch<SetStateAction<MemoryForm>>;
  addMemory: FormEventHandler<HTMLFormElement>;
};

export const DailyMemoryTab = ({
  state,
  updateState,
  memoryForm,
  setMemoryForm,
  addMemory,
}: Props) => (
  <div className="memory-content-grid" role="tabpanel">
    <section className="panel-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">长期上下文</p>
          <h2>生活记忆</h2>
        </div>
        <span className="count-chip">{state.memories.length} 条</span>
      </div>
      <div className="memory-card-grid">
        {state.memories.map((memory) => (
          <article key={memory.id} className="memory-card">
            <span className="memory-kind-icon">
              {memory.kind === "place" ? (
                <MapPin aria-hidden="true" size={20} />
              ) : (
                <BookHeart aria-hidden="true" size={20} />
              )}
            </span>
            <div>
              <small>
                {memory.kind} · {memory.sensitivity === "sensitive" ? "敏感" : "普通"}
              </small>
              <strong>{memory.title}</strong>
              <p>{memory.content}</p>
              <div className="tag-row">
                {memory.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </div>
            <button
              className="icon-button danger-ghost"
              type="button"
              aria-label={`删除记忆：${memory.title}`}
              onClick={() =>
                updateState((current) => ({
                  ...current,
                  memories: current.memories.filter(
                    (item) => item.id !== memory.id,
                  ),
                }))
              }
            >
              <Trash2 aria-hidden="true" size={18} />
            </button>
          </article>
        ))}
      </div>
    </section>

    <section className="panel-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">新增</p>
          <h2>告诉助手一件值得记住的事</h2>
        </div>
      </div>
      <form className="form-stack" onSubmit={addMemory}>
        <div className="form-grid two-columns">
          <label>
            类型
            <select
              value={memoryForm.kind}
              onChange={(event) =>
                setMemoryForm((current) => ({
                  ...current,
                  kind: event.target.value as MemoryKind,
                }))
              }
            >
              <option value="preference">沟通偏好</option>
              <option value="place">常用位置</option>
              <option value="person">人物关系</option>
              <option value="routine">生活习惯</option>
              <option value="story">家庭故事</option>
            </select>
          </label>
          <label>
            标题 <span aria-hidden="true">*</span>
            <input
              required
              placeholder="例如：眼镜常放位置"
              value={memoryForm.title}
              onChange={(event) =>
                setMemoryForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>
          <label className="full-span">
            内容 <span aria-hidden="true">*</span>
            <textarea
              required
              rows={4}
              placeholder="写清信息来源和可靠边界，例如：家属记录，眼镜通常放在客厅边柜托盘。"
              value={memoryForm.content}
              onChange={(event) =>
                setMemoryForm((current) => ({
                  ...current,
                  content: event.target.value,
                }))
              }
            />
          </label>
          <label className="full-span">
            标签
            <input
              placeholder="用逗号分隔，例如：眼镜，客厅，寻物"
              value={memoryForm.tags}
              onChange={(event) =>
                setMemoryForm((current) => ({
                  ...current,
                  tags: event.target.value,
                }))
              }
            />
          </label>
        </div>
        <button className="primary-button" type="submit">
          <Plus aria-hidden="true" size={19} /> 添加生活记忆
        </button>
      </form>
    </section>
  </div>
);
