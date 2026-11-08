import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LANGUAGES } from '../core/languages';
import { REPO_URL } from '../core/version';
import { AI_MODELS } from '../core/ai-models';
import { Icon } from '../shared/icon';
import { LocalizePipe } from '../shared/localize';
import { Logo } from '../shared/logo';
import { Reveal } from '../shared/reveal';

interface Feature {
  key: string;
  icon: string;
}

/** The comparison with online editors: LocalCutVideo has every row, they have it or not. */
interface CompareRow {
  key: string;
  them: 'no' | 'sometimes';
}

@Component({
  selector: 'app-landing',
  imports: [RouterLink, TranslocoPipe, Icon, Logo, Reveal, LocalizePipe],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  protected readonly repoUrl = REPO_URL;
  protected readonly aiModels = AI_MODELS;
  protected readonly languageCount = LANGUAGES.length;

  protected readonly features: Feature[] = [
    { key: 'speech', icon: 'globe' },
    { key: 'silences', icon: 'scissors' },
    { key: 'captions', icon: 'captions' },
    { key: 'aiImage', icon: 'sparkles' },
    { key: 'framing', icon: 'face' },
    { key: 'textEdit', icon: 'text' },
    { key: 'zoom', icon: 'zoom' },
    { key: 'ducking', icon: 'volume' },
    { key: 'clips', icon: 'layers' },
    { key: 'export', icon: 'zap' },
    { key: 'inputs', icon: 'film' },
    { key: 'recovery', icon: 'save' },
    { key: 'offline', icon: 'offline' },
    { key: 'languages', icon: 'globe' },
  ];

  protected readonly compareRows: CompareRow[] = [
    { key: 'free', them: 'sometimes' },
    { key: 'account', them: 'sometimes' },
    { key: 'auto', them: 'sometimes' },
    { key: 'upload', them: 'no' },
    { key: 'offline', them: 'no' },
  ];

  protected readonly steps = ['open', 'edit', 'export'];
  protected readonly spotlightPoints = ['moments', 'ai', 'title', 'formats', 'local'];
  protected readonly privacyPoints = ['upload', 'account', 'sensitive', 'storage'];
  protected readonly faq = ['free', 'capcut', 'formats', 'browsers', 'size', 'offline', 'ai'];
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
