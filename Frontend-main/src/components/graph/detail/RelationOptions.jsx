/** 관계 분석 모달의 연결 인물 목록·카드 (선택·"이 인물로 분석 전환") */

import { RELATION_CONNECTION_KIND } from '../../../utils/graph/graphCore';
import { getPositivityDisplay } from '../../../utils/graph/graphStyles';
import { joinClasses } from '../../../utils/common/domUtils';

function RelationTagsRow({ tags }) {
  if (!tags?.length) return null;
  return (
    <div className="tooltip-relation-tags">
      {tags.map((tag, i) => (
        <span key={i} className="tooltip-relation-tag">{tag}</span>
      ))}
    </div>
  );
}

function PositivityChip({ positivity }) {
  const { color, label, percent } = getPositivityDisplay(positivity);
  return (
    <div className="tooltip-positivity-chip" style={{ '--pos-color': color }}>
      <span className="tooltip-positivity-label">{label}</span>
      <div className="tooltip-positivity-percent">{percent}%</div>
    </div>
  );
}

function NameWithDot({ name, positivity, fontSize = '1rem' }) {
  const { color } = getPositivityDisplay(positivity);
  return (
    <div
      className="tooltip-name-with-dot"
      style={{ '--dot-color': color, '--dot-size': '0.7rem', '--name-font-size': fontSize }}
    >
      <div className="tooltip-name-dot" />
      <span className="tooltip-name-label">{name}</span>
    </div>
  );
}

function SwitchAnalysisButton({ item, onSwitch }) {
  if (!item || !onSwitch) return null;
  return (
    <button
      type="button"
      className="relation-modal-action-btn relation-modal-action-btn--secondary relation-modal-switch-inline"
      onClick={(e) => {
        e.stopPropagation();
        onSwitch(item);
      }}
    >
      이 인물로 분석 전환
    </button>
  );
}

/** 선택 가능한 연결 인물 항목: role=option 래퍼 + 본문 버튼(선택) + 관계 태그 + 활성 시 "분석 전환" 버튼 */
function RelationOption({ as, className, mainClassName, style, ariaPressed, item, active, onSelect, onSwitch, children }) {
  const Wrapper = as;
  return (
    <Wrapper
      className={joinClasses(className, active && 'is-active')}
      style={style}
      role="option"
      aria-selected={active}
    >
      <button
        type="button"
        className={mainClassName}
        aria-pressed={ariaPressed}
        onClick={() => onSelect(item)}
      >
        {children}
        <RelationTagsRow tags={item.relationTags} />
      </button>
      {active ? <SwitchAnalysisButton item={item} onSwitch={onSwitch} /> : null}
    </Wrapper>
  );
}

export function RelationList({
  items,
  activeName,
  onSelect,
  onSwitch,
}) {
  if (!items?.length) return null;

  return (
    <ul className="relation-modal-list" role="listbox" aria-label="연결된 인물 목록">
      {items.map((item) => {
        const { color, label, percent } = getPositivityDisplay(item.positivity);
        return (
          <RelationOption
            key={item.id || item.name}
            as="li"
            className="relation-modal-list-item"
            mainClassName="relation-modal-list-item-main"
            style={{ '--item-pos-color': color }}
            item={item}
            active={activeName === item.name}
            onSelect={onSelect}
            onSwitch={onSwitch}
          >
            <div className="relation-modal-list-item-head">
              <NameWithDot name={item.name} positivity={item.positivity} fontSize="1.15rem" />
              <div
                className="relation-modal-list-pos"
                style={{ '--pos-color': color }}
                aria-label={`긍정성 ${label} ${percent}%`}
              >
                <span className="relation-modal-list-pos-label">{label}</span>
                <span className="relation-modal-list-pos-value">{percent}%</span>
              </div>
            </div>
          </RelationOption>
        );
      })}
    </ul>
  );
}

function RelationCard({ item, active, onSelect, onSwitch, sourceName }) {
  if (!item) return null;

  return (
    <RelationOption
      as="div"
      className="relation-card"
      mainClassName="relation-card-main"
      ariaPressed={active}
      item={item}
      active={active}
      onSelect={onSelect}
      onSwitch={onSwitch}
    >
      <div className="relation-card-top">
        <NameWithDot name={item.name} positivity={item.positivity} fontSize="1.05rem" />
        <PositivityChip positivity={item.positivity} />
      </div>
      {sourceName ? (
        <p className="relation-card-pair-hint">
          {sourceName} ↔ {item.name}
        </p>
      ) : null}
    </RelationOption>
  );
}

export function FewConnectionsPanel({
  items,
  activeName,
  onSelect,
  onSwitch,
  sourceName,
  connectionKind,
}) {
  const isPair = connectionKind === RELATION_CONNECTION_KIND.PAIR;
  return (
    <div className="relation-few-panel">
      <div className="relation-modal-side-title">
        {isPair ? '연결된 인물 비교' : '연결된 인물'}
      </div>
      <p className="relation-modal-side-hint">
        {isPair
          ? '연결이 적어 관계 카드로 나란히 비교합니다. '
          : '연결이 적어 관계 카드로 표시합니다. '}
        챕터를 바꾸면 연결이 늘어날 수 있습니다.
      </p>
      <div
        className={`relation-card-grid${isPair ? ' is-pair' : ' is-single'}`}
        role="listbox"
        aria-label="연결된 인물 카드"
      >
        {items.map((item) => (
          <RelationCard
            key={item.id || item.name}
            item={item}
            active={activeName === item.name}
            onSelect={onSelect}
            onSwitch={onSwitch}
            sourceName={sourceName}
          />
        ))}
      </div>
    </div>
  );
}
