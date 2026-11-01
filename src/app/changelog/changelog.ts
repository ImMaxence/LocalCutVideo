import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe } from '@jsverse/transloco';
import { catchError, map, of } from 'rxjs';
import { APP_VERSION, CHANGELOG_URL, REPO_URL } from '../core/version';
import { Icon } from '../shared/icon';

interface Segment {
  text: string;
  code: boolean;
}

interface Release {
  version: string;
  date: string;
  sections: { title: string; items: Segment[][] }[];
}

/**
 * Parses CHANGELOG.md (Keep a Changelog format). The file at the repository root is copied
 * into the build, so the page and GitHub always show the same history.
 */
export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: Release['sections'][number] | null = null;
  for (const line of md.split(/\r?\n/)) {
    const h2 = line.match(/^## \[?([^\]\s]+)\]?(?:\s*-\s*(.+))?/);
    if (h2) {
      release = { version: h2[1], date: h2[2]?.trim() ?? '', sections: [] };
      releases.push(release);
      section = null;
      continue;
    }
    const h3 = line.match(/^### (.+)/);
    if (h3 && release) {
      section = { title: h3[1].trim(), items: [] };
      release.sections.push(section);
      continue;
    }
    const item = line.match(/^[-*] (.+)/);
    if (item && section) {
      section.items.push(item[1].split('`').map((text, i) => ({ text, code: i % 2 === 1 })));
    }
  }
  return releases;
}

@Component({
  selector: 'app-changelog',
  imports: [TranslocoPipe, Icon],
  templateUrl: './changelog.html',
  styleUrl: './changelog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Changelog {
  protected readonly version = APP_VERSION;
  protected readonly changelogUrl = CHANGELOG_URL;
  protected readonly repoUrl = REPO_URL;

  protected readonly releases = toSignal(
    inject(HttpClient)
      .get('/CHANGELOG.md', { responseType: 'text' })
      .pipe(
        map(parseChangelog),
        catchError(() => of(null)),
      ),
    { initialValue: undefined },
  );
}
