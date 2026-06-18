# AccessiMind Codex Plugin Marketplace

Public Codex marketplace package for the AccessiMind Accessible UI Agent plugin.

This plugin adds the `$accessimind` skill to Codex for WCAG 2.2 accessibility audits, accessible UI implementation, keyboard/focus analysis, real screen-reader evidence, agentic NVDA navigation, accessible HTML reports, and Jira-ready remediation tasks.

---

## Türkçe Kullanım

### Ne İşe Yarar?

AccessiMind Accessible UI Agent, Codex içinde erişilebilirlik odaklı UI denetimi ve uygulama işleri için kullanılır.

Başlıca kullanım alanları:

- WCAG 2.2 A/AA erişilebilirlik denetimi
- Klavye ve focus akışı analizi
- NVDA / ekran okuyucu kanıtı toplama
- Ajantik ekran okuyucu gezinimi ile gerçek kullanıcı akışı testi
- Erişilebilir HTML rapor üretimi
- Jira-ready `Summary`, `Description`, `Tasks / Yapılacaklar` çıktıları
- Codex plugin/UI yüzeylerinin WCAG 2.2 açısından kontrolü
- React, HTML, CSS, JS ve canlı web sayfası erişilebilirlik iyileştirmeleri

### Kurulum

Codex CLI veya Codex app ile bu public marketplace reposunu ekleyin:

```bash
codex plugin marketplace add sarperarikan/accessimind-codex--wcag-analysiss-plugIn
```

Ardından Codex app içinde:

1. `Plugins` bölümünü açın.
2. Marketplace olarak `AccessiMind Public` kaynağını seçin.
3. `AccessiMind Accessible UI Agent` plugin kartını açın.
4. Plugin'i install edin.
5. Yeni bir Codex thread açın veya Codex'i yeniden başlatın.

### Kısa Çağrı

Plugin kurulduktan sonra skill şu kısa adla çağrılır:

```text
$accessimind
```

### Örnek Promptlar

Canlı web sayfası denetimi:

```text
$accessimind https://example.com sayfasını WCAG 2.2, klavye ve ekran okuyucu açısından denetle. HTML rapor üret.
```

Menü / navigation analizi:

```text
$accessimind bu web sayfasındaki menü yapısını desktop modda test et. Klavye, focus, ARIA state ve NVDA kanıtıyla HTML raporla.
```

Jira görevleri üretme:

```text
$accessimind bu erişilebilirlik bulgularını Jira-ready Summary, Description, Acceptance Criteria ve Tasks / Yapılacaklar olarak düzenle.
```

Kod iyileştirme:

```text
$accessimind bu React componentini WCAG 2.2 uyumlu hale getir. Klavye, focus, screen reader ve reduced motion davranışlarını uygula.
```

Ajantik ekran okuyucu testi:

```text
$accessimind NVDA ile bu menüyü ekran okuyucu kullanıcısı gibi bul, aç ve kategori seçme görevini tamamlamaya çalış. Adım adım konuşma çıktısını raporla.
```

### Beklenen Çıktılar

Skill, göreve göre şunları üretebilir:

- HTML erişilebilirlik raporu
- Severity bazlı bulgu matrisi
- Evidence artifact yolları
- NVDA veya ekran okuyucu konuşma kanıtı
- Keyboard/focus traversal logları
- Low-vision ve motor erişilebilirlik ölçümleri
- Jira-ready üretim işleri
- Regression / QA test paketi

### Notlar

- Gerçek NVDA kanıtı için Windows ortamında NVDA ve gerekli automation runtime mevcut olmalıdır.
- Ekran okuyucu çalıştırılamazsa skill bunu açıkça `blocked` veya `unverified` olarak raporlar.
- DOM-only sonuçlar gerçek ekran okuyucu kanıtı gibi sunulmaz.
- HTML raporların kendisi de erişilebilir olacak şekilde üretilir.

---

## English Usage

### What Is This?

AccessiMind Accessible UI Agent is a Codex plugin for accessibility-focused UI audits and implementation work.

It is designed for:

- WCAG 2.2 A/AA accessibility audits
- Keyboard and focus-flow analysis
- NVDA / screen-reader evidence collection
- Agentic screen-reader navigation for task-based testing
- Accessible HTML audit reports
- Jira-ready `Summary`, `Description`, and task breakdowns
- WCAG checks for Codex plugin/UI surfaces
- Accessible React, HTML, CSS, JS, and live-site remediation

### Installation

Add this public marketplace repository to Codex:

```bash
codex plugin marketplace add sarperarikan/accessimind-codex--wcag-analysiss-plugIn
```

Then in the Codex app:

1. Open `Plugins`.
2. Select the `AccessiMind Public` marketplace.
3. Open the `AccessiMind Accessible UI Agent` plugin card.
4. Install the plugin.
5. Start a new Codex thread or restart Codex if the skill does not appear immediately.

### Short Invocation

After installation, invoke the bundled skill with:

```text
$accessimind
```

### Example Prompts

Live website audit:

```text
$accessimind audit https://example.com for WCAG 2.2, keyboard access, and screen-reader behavior. Generate an HTML report.
```

Menu / navigation analysis:

```text
$accessimind test this site's menu structure in desktop mode. Report keyboard, focus, ARIA state, and NVDA evidence in HTML.
```

Jira-ready tasks:

```text
$accessimind convert these accessibility findings into Jira-ready Summary, Description, Acceptance Criteria, and Tasks.
```

Code remediation:

```text
$accessimind make this React component WCAG 2.2 compliant. Implement keyboard, focus, screen-reader, and reduced-motion behavior.
```

Agentic screen-reader test:

```text
$accessimind use NVDA like a screen-reader user to find, open, and operate this menu. Report the step-by-step spoken output.
```

### Expected Outputs

Depending on the task, the skill can produce:

- Accessible HTML audit reports
- Severity-ranked finding matrices
- Evidence artifact paths
- NVDA or screen-reader speech evidence
- Keyboard/focus traversal logs
- Low-vision and motor-accessibility measurements
- Jira-ready production tasks
- Regression / QA verification packs

### Notes

- Real NVDA evidence requires a Windows environment with NVDA and the required automation runtime installed.
- If screen-reader automation cannot run, the skill reports the result as `blocked` or `unverified`.
- DOM-only findings are not presented as real screen-reader evidence.
- Generated HTML reports are expected to be accessible themselves.

---

## Package Contents

- `.agents/plugins/marketplace.json`: Codex marketplace catalog.
- `plugins/accessimind-accessible-ui-agent`: Codex plugin package.
- `plugins/accessimind-accessible-ui-agent/skills/accessimind`: bundled skill invoked as `$accessimind`.
