import { Pipe, type PipeTransform, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { localizedPath } from '../core/i18n';

/** Link to a public page in the current language: `'/changelog' | localize` → '/fr/changelog'. */
@Pipe({ name: 'localize', pure: false })
export class LocalizePipe implements PipeTransform {
  private readonly transloco = inject(TranslocoService);

  transform(path: string): string {
    return localizedPath(path, this.transloco.getActiveLang());
  }
}
