import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LANGUAGES } from '../core/languages';
import { REPO_URL } from '../core/version';
import { Icon } from '../shared/icon';
import { LocalizePipe } from '../shared/localize';
import { Reveal } from '../shared/reveal';

interface Feature {
  key: string;
  icon: string;
}

@Component({
  selector: 'app-landing',
  imports: [RouterLink, TranslocoPipe, Icon, Reveal, LocalizePipe],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  protected readonly repoUrl = REPO_URL;
  protected readonly languageCount = LANGUAGES.length;

  protected readonly features: Feature[] = [
    { key: 'silences', icon: 'scissors' },
    { key: 'clips', icon: 'layers' },
    { key: 'textEdit', icon: 'text' },
    { key: 'captions', icon: 'captions' },
    { key: 'framing', icon: 'face' },
    { key: 'zoom', icon: 'zoom' },
    { key: 'ducking', icon: 'volume' },
    { key: 'recovery', icon: 'save' },
    { key: 'offline', icon: 'offline' },
    { key: 'export', icon: 'zap' },
    { key: 'inputs', icon: 'film' },
    { key: 'languages', icon: 'globe' },
  ];

  protected readonly steps = ['open', 'edit', 'export'];
  protected readonly spotlightPoints = ['moments', 'title', 'formats', 'local'];
  protected readonly privacyPoints = ['upload', 'account', 'csp', 'storage'];
  protected readonly faq = ['free', 'formats', 'browsers', 'size', 'offline', 'ai'];
  protected readonly browsers = [
    { name: 'Chrome / Edge', key: 'full', level: 'ok' },
    { name: 'Opera / Brave', key: 'full', level: 'ok' },
    { name: 'Firefox', key: 'firefox', level: 'partial' },
    { name: 'Safari', key: 'safari', level: 'partial' },
  ];

  /** Deterministic pseudo-waveform for the hero mockup. */
  protected readonly bars = Array.from({ length: 96 }, (_, i) => {
    const silent = (i > 20 && i < 30) || (i > 58 && i < 66);
    const v = Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.37) * 0.4);
    return { h: silent ? 6 + (i % 3) * 2 : 18 + v * 70, cut: silent };
  });
}
