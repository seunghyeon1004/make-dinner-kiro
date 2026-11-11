import { Component } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { COPY } from '../copy.js';

interface Props {
  children: ComponentChildren;
}
interface State {
  failed: boolean;
}

/** Catches a render throw (R10.2): logs to the console only, offers Reload. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  override componentDidCatch(error: unknown): void {
    console.error(error);
    this.setState({ failed: true });
  }

  override render(): VNode {
    if (!this.state.failed) return <>{this.props.children}</>;
    return (
      <main class="screen">
        <h1 tabIndex={-1}>{COPY.errorHeading}</h1>
        <p>{COPY.errorBody}</p>
        <div class="actions">
          <button type="button" class="button button--primary" onClick={() => location.reload()}>
            {COPY.reload}
          </button>
        </div>
      </main>
    );
  }
}
