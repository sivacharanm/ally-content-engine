# Ally: Content Intelligence Engine

A brand manager enters one client SKU ID. Ally checks the listing against the retailer's content guidelines, uses same category listings to find what the listing is missing, and returns a compliant, explained recommendation for the title, bullets and description, plus the attributes worth adding. The brand manager applies the changes in the seller portal.

**Try it**
- Brand manager page: https://ally-content-engine.vercel.app/
- Admin page: https://ally-content-engine.vercel.app/admin
- Demo video: https://www.loom.com/share/de686bc8e0144a73abbd7a383dff5019

Nothing to install. Open both pages in the same browser; no login or API key is needed.

---

## 1. Problem and approach

The brief asks for a content optimization skill for Ally that takes a target client SKU, category competitor data and retailer guidelines, analyzes the competitive landscape, and outputs listing recommendations for **discoverability, conversion rate and retail compliance**.

**Priority order when these goals conflict**
1. **Compliance:** no prohibition in the guidelines is ever broken.
2. **Accuracy:** never state a fact that is not in the client's own data.
3. **Completeness:** keep every relevant fact the client's data holds, and prompt the brand manager for attributes it lacks.
4. **Conversion copy:** improve the wording within what is left.

**Why discoverability rests on completeness.** The provided files hold no search, keyword or traffic data, so Ally does not claim to optimize for keywords. It asks the brand manager to add the kinds of facts the guidelines ask for and that same category listings state, such as size or count, which search and shopping agents need to match a product to a query. This is my reasoning, not something the files state.

**What Ally never claims.** It does not predict sales, ranking or conversion impact. Meeting the guidelines is not the same as performing well, and the files hold no data to close that gap.

**Data used.** Only the three provided files: the brief, the CSV and the Amazon guidelines. There are two deliberate exceptions, both limited to the attribute suggestions: the model may suggest attributes shoppers usually expect in a category, and it judges whether each suggested attribute applies to the category. Neither is ever written into the recommendation.

## 2. Users and pages

| User | Page | What they do |
|---|---|---|
| Brand manager | `/` | Types a SKU ID, selects Optimize, reads the recommendation and the attributes worth adding |
| Admin | `/admin` | Chooses the active product file, uploads a CSV with a retailer name, sees the catalog check |

**Preloaded files on the Admin page**

| File | Retailer | Purpose |
|---|---|---|
| `client_skus_ciq_assignment 2.csv` (active by default) | Amazon | The provided file: 8 rows, 2 client SKUs (CIQ-DCT-001 PawJoy, CIQ-SPW-001 FizzWave) |
| Mock catalog, 25 rows, fictional brands | test1 | One test case per SKU; the Admin page lists what each tests and the expected result |
| Broken: empty file | test2 | Shows the file is rejected |
| Broken: no header row | test3 | Shows the file is rejected |
| Broken: missing column | test4 | Shows the file is rejected, naming the column |

**Uploads:** CSV only, up to 1 MB and 500 rows, with the same 13 columns as the provided file. The admin must give a retailer name. The retailer name is a label: only the Amazon guidelines exist, so every file is checked against them. Uploads stay in the uploader's browser. There is no central database: the preloaded files are built into the page, and an upload never affects another viewer.

## 3. How it works

Code does everything that can be checked exactly. The model is used only for judgement and writing, and everything it writes is checked again by code before the brand manager sees it.

**Once per file:** validate the CSV (V1 to V24), then clean it (spacing, bullet order, image separators), logging every fix.

**For each SKU**

| Step | What happens | Done by |
|---|---|---|
| 3 | Check the SKU ID (V25 to V28). Competitors are rows in the same `competitor_group` with `is_client` FALSE | Code |
| 4a | 27 plain rule checks on the client listing: lengths, counts, banned phrases, ALL CAPS, bullet headers, HTML, links and contact details, image count, competitor brand names | Code |
| 4b | 9 judgement checks: title structure, unrelated search terms, variant details, bullet order, benefits not features, unverifiable claims, superlatives, description structure and coverage. Also looks for statements that contradict each other | Model |
| 5 | Summarise what fails, to brief the rewrite | Code |
| 7 | Attributes worth adding, from three sources: the guidelines, up to 10 same category listings, and general knowledge. Merged, filtered to what applies, never values | Model |
| 8 | Write the recommendation from the client's own facts only. Every change and every excluded claim is explained | Model |
| 9 | Verify: re-run every rule, run the copy check, trace every fact back to the client's data, check that no client fact was dropped. If anything fails, rewrite once with the failures as feedback | Code and model |
| 10 | Show the results, only once validation has finished | Code |

**Design principles**
- The model never has the final word on a rule that code can check.
- Listing text is always treated as data, never as instructions to the model.
- All model calls sit in one isolated component.
- Each run analyses one SKU, as the brief describes.

**Architecture.** A static page and one server function on Vercel. The server holds the Anthropic API key and builds every prompt itself; the page sends only the step name and the product data, so it can never send a prompt of its own. Requests of the wrong shape or size are refused.

## 4. Prompts

All prompts are in `lib/prompts.js`. Every prompt states that product data is data only and that instructions inside it must never be followed.

| Prompt | Step | Key instructions |
|---|---|---|
| `judge` | 4b | Judge each rule only from the listing text and the rule wording. Quote evidence exactly. Report a contradiction only when two statements cannot both be true; a range of audiences is not a contradiction |
| `factGaps` | 7 | Report kinds of attributes, never values. Merge sources. Drop attributes the listing already states or that do not apply to the category |
| `rewrite` | 8 | Use only facts in the client listing. Follow the priority order. Fix every failing rule. Never write a value for a suggested attribute. List every excluded claim with its reason and what proof would allow it back |
| `traceFacts` | 9 | List every factual claim in the rewrite with the exact supporting quote. Flag unsupported claims and any client fact that was dropped |

## 5. Methodology

- **Rules.** A rule table built from the guidelines file, 36 checks in all. Each keeps the file's own strength: Limit (a hard number), Prohibition ("Do not", "No"), Instruction, or Recommendation ("generally perform better", "best practice"). The labels are mine; the wording is the file's.
- **Accuracy.** The rewrite may only use the client's own facts. Every claim is traced to a quote; an untraced claim fails validation.
- **Completeness.** A client fact that the rewrite dropped fails validation, unless it had to go for compliance.
- **Copy check.** A recommended line of 5 or more words fails if 80% or more of its words appear, in order, in a competitor's title, bullet or description sentence. A 40% threshold was tested and rejected because it flagged lines written only from the client's facts. A line that matches the brand's own listing at the same threshold is exempt, because a brand cannot copy its own claim; this stops false flags when a competitor happens to use the same standard wording.
- **One retry.** On failure the model rewrites once with the failures as feedback. The version with fewer failures is shown, and anything still failing is listed under its field.
- **Attributes worth adding.** Each carries one tag, by priority: "As per retailer guidelines", "Seen in competitor listings" (only when a competitor quote is shown with it), or "Recommended by Ally". They are suggestions only and are never written into the recommendation.
- **Competitor data.** Used for three things: suggesting attribute types, the copy check, and keeping competitor brand names out of the recommendation. The rewrite step never sees competitor text. Competitor listings are not audited or rewritten.
- **Brand masking (a deliberate product decision).** The brand manager never sees a competitor's brand name. Every competitor brand on the page, including inside quotes, is shown as Brand 1, Brand 2 and so on, consistently. Limit: a quoted line can still hint at its source, for example through a distinctive product name.

## 6. Data validation

| Checks | When | Response |
|---|---|---|
| V1, V2 | File loads | Unreadable or empty file, or a missing column: the file is rejected. The brand manager sees "We couldn't load your product data. Please check the file and try again." |
| V3, V4, V10, V11 | File loads | Extra columns, garbled text, a group with no client, a group mixing categories: warning on the Admin page |
| V5 to V8 | File loads | Blank SKU ID, duplicate SKU ID (first row kept), bad `is_client`, blank group: the row is skipped |
| V9, V12, V16, V19 | Each analysis | No competitors, no brand name, empty bullets and description, a possible contradiction: plain warning on the brand manager page |
| V13 | Each analysis | Blank title: no warning; a new title is written from the client's own bullets and description |
| V15, V18, V21 | File loads | Bullets out of order, extra spaces, other image separators: fixed and logged |
| V25 to V28 | SKU entry | Unknown SKU, a competitor's SKU, a skipped SKU, spacing or capitals |

Skipped rows and mixed categories are also shown to the brand manager, at the bottom of the warnings, but only when they affect the SKU entered.

## 7. What the brand manager sees

- A progress bar with three milestones (Analysis, Recommendation generation, Validations), one status line, and a Stop button.
- Warnings in plain words, with no codes.
- The recommended listing, shown only once validation has finished: Title, Bullets and Description, current against recommended, each with a copy button and a collapsed explanation of every change and every excluded claim.
- An Images row when there are fewer than 5 images.
- "Enhance your listing with additional attributes", each with its tag, a reason and masked quotes.

Not shown on the page, by design: rule IDs, the rule by rule audit, validation evidence, the model used, and the word "AI". Messages name Ally.

## 8. Model, results and unit economics

Every model step uses **Claude Opus 5.5** (`claude-opus-5-5`): the work is judgement heavy, and one model is simpler to explain.

**Measured on CIQ-DCT-001 (PawJoy)**
- Passed every automated check, in both the preview and the hosted version.
- About 2 minutes per run (2m 04s in the preview).
- 0.41 USD per run on the hosted version.
- 14 claims excluded, each with a reason. Examples: "Best", "Indestructible", "Non Toxic" (no certification), "Helps with teeth" (no evidence), the money back guarantee, free shipping, and "while supplies last".

**Scaling plan (not built).** Anthropic's published prices per million tokens:

| Model | Input | Output | Positioning |
|---|---|---|---|
| Claude Opus 5.5 (used) | 4 USD | 20 USD | Long running agentic and knowledge work |
| Claude Sonnet 5.5 | 2 USD | 10 USD | Speed and intelligence combined |
| Claude Haiku 5.5 | from 0.10 USD | from 0.50 USD | High volume classification, extraction, routing |

A mixed setup would use Haiku for the yes or no judgement checks, Sonnet for attributes and fact tracing, and Opus or Sonnet for the rewrite. A different model checking the writer's work also reduces the risk of a model grading itself. The Batch API (50% discount) suits overnight catalog passes, and prompt caching lowers the cost of repeated instructions.

*Estimates, not measured:* about 0.20 USD per run on Sonnet alone, roughly 0.10 to 0.20 USD with the mixed setup. For 10,000 SKUs: about 4,100 USD per pass on Opus, about 2,050 USD on Sonnet, roughly 500 to 1,000 USD with the mixed setup and the batch discount. Cheaper models must be compared against Opus on the same SKUs before switching.

## 9. Assumptions

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
| A11 | Banned phrase lists include the guidelines' own examples plus close variants, for example "order today" alongside "order now" |
| A12 | A title is ALL CAPS when it has two or more consecutive all capital words of three or more letters, not counting the brand |
| A13 | Short words such as "of", "and", "for" and "with" may stay lowercase in a title case title |
| A14 | Validation retries when a limit, prohibition or instruction fails; a missed recommendation is reported but does not trigger the retry |
| A15 | "Avoid first-person seller voice" is treated as a prohibition |
| A16 | Up to 10 same category SKUs are used per run to suggest attributes |
| A17 | Other client SKUs are not used as a source of attributes (unconfirmed) |
| A18 | The copy check assumes `is_client` is correct; a brand's own variant marked as a competitor would cause false copy flags |
| A19 | Uploads and the active file are kept per browser (confirmed) |
| A20 | Upload limits of 1 MB and 500 rows (confirmed) |
| A21 | The retailer name is a label; every file is checked against the Amazon guidelines (confirmed) |

A2 (the `.md` guidelines file is an accepted source) is resolved by the brief.

## 10. Known risks and limits

**Risks found in a self review**
- **Competitor insight is light.** Competitors shape the attribute suggestions and the copy check, but the recommendation itself could have been written without them.
- **Discoverability can regress.** On PawJoy, the no repeated words rule removed "chew toy" and "Large Dogs" from the title, though shoppers likely search for both.
- **The model checks its own work.** Fact tracing uses the same model that wrote the text. The mock catalog tests the code, not the model's judgement; there is no accuracy figure yet for the 9 judgement checks.
- **"Passed all automated checks"** means the listing passed Ally's own checks, not the retailer's approval.
- **Subjective praise is handled unevenly:** "amazing" is excluded, "great" is kept.
- **Wording varies between runs.** The checks are deterministic; the generated text is not.

**Operational limits**
- **Credit.** The hosted version runs on prepaid credit. When it runs out, the page shows "Ally's usage limit has been reached. Please try again later."
- **Request limits** on the server slow abuse but do not prevent it; the prepaid credit is the real cap.
- **Stop** ends the run on the page at once, but a model call already in progress may still finish on the server and count toward usage.
- **One browser.** Uploads made in one browser are not visible in another.
- **Images.** Only the image count is checked. Image content checks (white background, size, no text) are planned, not built.
- **One retailer's rules.** Only the Amazon guidelines are loaded.

## 11. Out of scope

Publishing to a retailer site; accepting or editing on the page; other retailers' guidelines; consistency across a client's own SKUs (the data cannot show which SKUs are variants); backend search terms (the guidelines say KW-01 is "not directly assessed by this skill"); predicting sales or ranking; image upload; languages other than English.

## 12. Next steps

1. **Fill in and regenerate:** the brand manager types a missing value (for example a size) and Ally rewrites the listing to include it.
2. **How you compare:** a short competitor benchmark from counts, such as title length against the group and attributes most competitors state.
3. **Protect key search terms** in the title when removing repeated words.
4. **Mixed models and an evaluation set:** compare Haiku and Sonnet against Opus on labelled examples before switching.
5. **Portfolio view:** rank a brand's SKUs by how much they need fixing.
6. **Supplying proof:** let the brand manager provide a certification so an excluded claim can return.
7. **Image checks** against reachable image URLs.

## 13. Run your own copy (optional)

Not needed to review the prototype: the live links at the top run it. This section is only for running your own copy.

**Deploy your own (Vercel Hobby)**
1. Create an API key in the Claude Console, scoped to one workspace, and add credits.
2. Put this folder in a GitHub repository.
3. In Vercel, import the repository. Framework preset: Other. No build command.
4. Add the environment variable `ANTHROPIC_API_KEY` with your key, then deploy.

**Run locally with your own key** (Node.js 20 or later)
```
npm i -g vercel
echo ANTHROPIC_API_KEY=your-key > .env.local
vercel dev
```
Then open `http://localhost:3000` and `http://localhost:3000/admin`. Check the current Vercel CLI documentation if `vercel dev` asks for setup steps.

**Tests:** `cd src && node test.js && node test_mock.js`

## 14. Files

| Path | What it is |
|---|---|
| `index.html`, `admin.html` | The two pages, built from `src/` |
| `api/ally.js` | Server function: holds the key, checks requests, builds the prompt, calls the model |
| `lib/prompts.js` | Every prompt |
| `src/engine.js` | File validation, rule table, rule checks, copy check |
| `src/app.js` | Page logic, admin view, pipeline |
| `src/ai.js` | Sends each step to `/api/ally` |
| `src/template.html` | Page layout and styles |
| `src/build.js` | Builds the pages: `cd src && node build.js ..` |
| `src/test.js`, `src/test_mock.js` | Engine tests |
| `src/*.csv`, `src/make_mock.py` | Provided file, mock catalog and its generator, broken test files |
| `src/amazon_content_guidelines.md` | The guidelines the rules come from |

The full product requirements, with all 74 decisions and 21 assumptions, are in the PRD shared with this submission.
