import { IconInfo } from "../../components/icons";
import type { OfficialState } from "./official";

/**
 * The official-release line, in the three states it can be in.
 *
 * The visual weight is the message. A day with official releases states a fact and is set like the
 * other masthead figures. A quiet day is set quietly, in the same grey as the other annotations:
 * zero official releases is most days, and marking it would either be noise or, worse, train the
 * reader to ignore the one state that does mean something. A day whose collection was incomplete
 * is the only one that takes a warning colour, and it keeps its count on screen at the same time.
 */
export function OfficialTallyLine({ state }: { state: OfficialState }) {
  if (state.kind === "empty") {
    return <span className="whitespace-nowrap text-[13px] leading-none text-ink-3">{state.headline}</span>;
  }
  if (state.kind === "incomplete") {
    return (
      <span
        className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-warn"
        /* The count that did arrive sits in the same element as the warning, on purpose: a reader
           who saw only the warning would have to guess whether anything was collected at all. */
        title={`${state.headline}（${state.missed} 个官方源未成功采集，已采到的部分照常发布）`}
      >
        <IconInfo size={14} className="shrink-0 self-center" />
        <span className="text-[13px] leading-none">{state.headline}</span>
        <span className="num text-[22px] font-bold leading-none text-ink @[880px]:text-[24px]">{state.events}</span>
        <span className="text-[12px] leading-none text-ink-3">项已采到</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap" title={state.headline}>
      <span className="num text-[22px] font-bold leading-none tracking-[-0.02em] text-ink @[880px]:text-[24px]">{state.events}</span>
      <span className="text-[12px] text-ink-4">项官方发布</span>
    </span>
  );
}
