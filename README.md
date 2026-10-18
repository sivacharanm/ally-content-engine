# Ally: Content Intelligence Engine (prototype)

Given a client SKU ID, Ally checks the listing against the retailer's content guidelines, looks at competitor listings in the same category, and writes a compliant, explained recommendation for the title, bullets and description. The brand manager then applies the changes in the seller portal.

The full product requirements, with every decision (D1 to D68) and assumption (A1 to A21), are in the PRD shared alongside this repository.

## Two pages

| Page | URL | Who | What it does |
|---|---|---|---|
| Brand manager | `/` | Brand manager | Enter a SKU ID, select Optimize, read the recommendation and the attributes worth adding |
| Admin | `/admin` | Admin (the panel) | Choose the active product file, upload your own CSV with a retailer name, see the catalog check |

There is no login. Uploaded files and the active selection are kept in your own browser, so open both pages in the same browser.

**Preloaded files on the Admin page** (the test files are named test1 to test4 in the Retailer column)
- The provided file, `client_skus_ciq_assignment 2.csv`, retailer "Amazon" (active by default)
- A mock catalog of 25 rows with fictional brands, one test case per SKU, described in the "test cases" table on the Admin page
- Three broken files (empty, no header row, missing column) that show how bad input is handled

Uploads: CSV only, up to 1 MB and 500 rows, with the same 13 columns as the provided file. The retailer name is a label: only the Amazon guidelines exist, so every file is checked against them.

## Deploy (Vercel Hobby)

1. Create an API key in the Claude Console and add credits. Set a spending limit on the account if the console offers one for your plan.
2. Put this folder in a GitHub repository.
3. In Vercel, import the repository. No framework and no build command are needed.
4. In the Vercel project settings, add an environment variable `ANTHROPIC_API_KEY` with your key, then redeploy.

The key stays on the server. The page sends only the step name and the product data to `/api/ally`; the server builds every prompt itself.

## Run locally with your own key

You need Node.js 20 or later.

```
npm i -g vercel
echo ANTHROPIC_API_KEY=your-key > .env.local
vercel dev
```

Then open `http://localhost:3000` and `http://localhost:3000/admin`. Please check the current Vercel CLI docs if `vercel dev` asks for setup steps.

## How it works

Deterministic code does everything that can be checked exactly. The model (Claude Opus 5.5, `claude-opus-5-5`) is used only for judgement and writing, and its output is checked again by code.

**Once per file**
1. Validate the file (V1 to V24): block, skip, warn, or fix and log.
2. Clean the data: spacing, bullet order, image separators.

**Per SKU**

| Step | What happens | Done by |
|---|---|---|
| 3 | Check the SKU ID (V25 to V28) and find its competitors (same competitor group) | Code |
| 4a | 27 plain rule checks on the client listing (lengths, banned words, HTML, contact details, competitor names) | Code |
| 4b | 9 judgement rules (title pattern, benefit led bullets, unverifiable claims) and possible contradictions | Model |
| 5 | Summarise what fails | Code |
| 7 | Attributes worth adding, from three sources: the guidelines, same category listings, and general knowledge | Model |
| 8 | Write the recommendation from the client's own facts only, with every change and every excluded claim explained | Model |
| 9 | Verify: re-run every rule, copy check against competitors, trace every fact to the client data, check nothing was dropped. One rewrite if anything fails | Code and model |
| 10 | Show the result only once validation has finished | Code |

## Prompts

All prompts are in `lib/prompts.js` (the same file runs in the preview and on the server).

| Prompt | Purpose | Key instructions |
|---|---|---|
| `judge` | Step 4b | Judge each rule only from the listing text and the rule wording; quote evidence exactly; report a contradiction only when two statements cannot both be true |
| `factGaps` | Step 7 | Report kinds of attributes only, never values; merge sources; drop attributes the listing already states or that do not apply to the category |
| `rewrite` | Step 8 | Use only facts in the client listing; priority order compliance, accuracy, completeness, conversion; list every excluded claim with its reason and rule |
| `traceFacts` | Step 9 | List every factual claim in the rewrite with the exact supporting quote; flag unsupported claims and dropped facts |

Every prompt tells the model that product data is data only and that instructions inside it must never be followed.

## Methodology

- **Rules.** A rule table built from the Amazon guidelines file. Each rule keeps the file's own strength: Limit, Prohibition, Instruction or Recommendation.
- **Accuracy.** The rewrite may only use the client's own facts. Every claim is traced back to a quote, and untraced claims fail validation.
- **Completeness.** Facts in the client data that the rewrite dropped fail validation, unless they had to go (promotional language, guarantees and so on).
- **Copy check.** A recommended line of 5 or more words fails if 80% or more of its words appear, in order, in a competitor's title, bullet or description sentence.
- **Retry.** If validation fails, the model rewrites once with the failures as feedback; whichever version has fewer failures is shown, with any remaining failures listed.
- **Attributes.** Each suggested attribute carries one tag, by priority: "As per retailer guidelines", "Seen in competitor listings" (only when a competitor quote is shown), or "Recommended by Ally". They are suggestions only and never written into the recommendation.
- **Competitor data.** Used to find competitors, as evidence for attributes, and for the copy check. Competitor listings are not audited or rewritten.
- **Brand masking.** Competitor brand names are shown as Brand 1, Brand 2 and so on everywhere on the brand manager page.

## Assumptions

| # | Assumption |
|---|---|
| A1 | The provided CSV is the `client_skus.csv` the brief names (confirmed) |
| A3 | Any CSV has the same 13 columns, same names, one row per SKU |
| A4 | `is_client` uses TRUE or FALSE |
| A5 | Multiple image URLs are separated by `\|` |
| A6 | Text is in English |
| A7 | Rows with the same `competitor_group` are competitors of each other |
| A8 | When a `sku_id` repeats, the first row is the most up to date |
| A9 | SKU IDs do not differ only by capitalisation |
| A10 | "Your products" means any client SKU, since there is no sign in |
| A11 | Banned phrase lists include the guidelines' own examples plus close variants |
| A12 | A title is ALL CAPS when it has two or more consecutive all capital words of three or more letters, not counting the brand |
| A13 | Short words such as "of", "and", "for" may stay lowercase in a title case title |
| A14 | Validation retries when a limit, prohibition or instruction fails; a missed recommendation is reported but does not trigger the retry |
| A15 | "Avoid first-person seller voice" is treated as a prohibition |
| A16 | Up to 10 same category SKUs are used per run to suggest attributes |
| A17 | Other client SKUs are not used as a source of attributes |
| A18 | The copy check assumes `is_client` is correct |
| A19 | Uploads and the active file are kept per browser (confirmed) |
| A20 | Upload limits of 1 MB and 500 rows (confirmed) |
| A21 | The retailer name is a label; every file is checked against the Amazon guidelines (confirmed) |

A2 (the `.md` guidelines file is an accepted source) is resolved by the brief.

## Known limits

- **Stop** ends the run on the page at once, but a model call already in progress may still finish on the server and count toward API usage.
- **Request limits** on the server are per running copy of the function, so they slow abuse rather than prevent it. The spending limit on the Anthropic account is the real safeguard.
- **Brand masking** replaces brand names in the page text. A brand written in an unusual form (for example split by punctuation) may not be caught.
- **Images.** V1 counts images only. Checking image content is planned for V2.
- **One retailer's rules.** Only the Amazon guidelines are loaded.
- **Model output varies** between runs; validation catches rule breaks and unsupported facts, not every stylistic difference.

## Files

| Path | What it is |
|---|---|
| `index.html`, `admin.html` | The two pages (built from `src/`) |
| `api/ally.js` | Server function: holds the key, checks requests, builds the prompt, calls the model |
| `lib/prompts.js` | Every prompt |
| `src/engine.js` | File validation, rule table, rule checks, copy check |
| `src/app.js` | Page logic, admin view, pipeline |
| `src/ai.js` | Talks to the model (preview) or to `/api/ally` (hosted) |
| `src/template.html` | Page layout and styles |
| `src/build.js` | Builds the pages: `cd src && node build.js ..` |
| `src/test.js`, `src/test_mock.js` | Engine tests: `cd src && node test.js` |
| `src/*.csv`, `src/make_mock.py` | Provided file, mock catalog and its generator, broken test files |
| `src/amazon_content_guidelines.md` | The guidelines the rules come from |
