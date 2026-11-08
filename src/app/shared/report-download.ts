import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { APP_VERSION, REPO_URL } from '../core/version';
import { Icon } from './icon';

/** Link to open a GitHub issue, already filled in, when a model cannot be downloaded. */
@Component({
  selector: 'app-report-download',
  imports: [TranslocoPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a [href]="url()" target="_blank" rel="noopener"><app-icon name="github" [size]="13" /> {{ 'common.reportDownload' | transloco }}</a>
  `,
  styles: `
    :host {
      display: block;
    }
    a {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12.5px;
      color: var(--text-muted);
      text-decoration: underline;
    }
    app-icon {
      flex: none;
    }
  `,
})
export class ReportDownload {
  /** The model concerned, named in the issue. */
  readonly model = input.required<string>();

  protected readonly url = computed(() => {
    const title = `Model download failed: ${this.model()}`;
    const body = `Model: ${this.model()}\nApp version: ${APP_VERSION}\nBrowser and operating system: \nWhat happened (error message, how far it went): \n`;
    return `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  });
}
