import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Kitchen, Plan, ServeTime } from '../../core/index.js';
import { EXPORT_COPY } from '../copy.js';
import { copyText } from '../state/clipboard.js';
import { useDispatch } from '../state/hooks.js';
import { encodeShare, SHARE_URL_MAX, shareUrl } from '../state/share-link.js';
import { DinnerfilePanel } from './DinnerfilePanel.js';
import { SharePanel } from './SharePanel.js';
import type { ShareState } from './SharePanel.js';

type Panel = 'dinnerfile' | 'share' | null;

interface Props {
  dinnerfileText: string;
  plan: Plan;
  kitchen: Kitchen;
  serve: ServeTime;
}

/** Dinnerfile, Share link and Print (R8.1); a button opens its panel, tapping it again closes it. */
export function ExportBar(props: Props): VNode {
  const dispatch = useDispatch();
  const [open, setOpen] = useState<Panel>(null);
  const [share, setShare] = useState<ShareState>({ status: 'pending' });
  const [selectToken, setSelectToken] = useState(0);
  const latest = useRef(share);
  latest.current = share;

  // The link is ready before the tap, so the copy happens inside the user's gesture (Safari).
  useEffect(() => {
    let stale = false;
    setShare({ status: 'pending' });
    void encodeShare({ plan: props.plan, kitchen: props.kitchen, serve: props.serve }).then(
      (encoded) => {
        if (stale) return;
        if (!encoded.ok) return setShare({ status: 'unavailable' });
        const url = shareUrl(`${location.origin}${location.pathname}`, encoded.value);
        setShare(
          url.length > SHARE_URL_MAX
            ? { status: 'too_long', length: url.length }
            : { status: 'ready', url },
        );
      },
    );
    return () => {
      stale = true;
    };
  }, [props.plan, props.kitchen, props.serve]);

  const copyLink = async (): Promise<void> => {
    const current = latest.current;
    if (current.status !== 'ready') return;
    if (await copyText(navigator.clipboard, current.url)) {
      dispatch({ type: 'notice/set', text: EXPORT_COPY.copiedLink });
    } else {
      setSelectToken((token) => token + 1);
      dispatch({ type: 'notice/set', text: EXPORT_COPY.copyFailed });
    }
  };

  const toggle = (panel: Exclude<Panel, null>): void => {
    const opening = open !== panel;
    setOpen(opening ? panel : null);
    if (opening && panel === 'share') void copyLink();
  };

  return (
    <div class="export">
      <div class="actions">
        <button
          type="button"
          class="button"
          aria-expanded={open === 'dinnerfile'}
          onClick={() => toggle('dinnerfile')}
        >
          {EXPORT_COPY.dinnerfile}
        </button>
        <button
          type="button"
          class="button"
          aria-expanded={open === 'share'}
          onClick={() => toggle('share')}
        >
          {EXPORT_COPY.shareLink}
        </button>
        <button type="button" class="button" onClick={() => window.print()}>
          {EXPORT_COPY.print}
        </button>
      </div>
      {open === 'dinnerfile' && <DinnerfilePanel text={props.dinnerfileText} />}
      {open === 'share' && (
        <SharePanel share={share} onCopy={() => void copyLink()} selectToken={selectToken} />
      )}
    </div>
  );
}
