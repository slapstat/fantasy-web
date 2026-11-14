# Copy rules

This file contains machine-checkable copy rules. Editorial judgment belongs in the
`slapstat-copy` skill.

## Terminology

Use one canonical term for each product concept. Do not introduce synonyms for the same concept
unless they refer to something genuinely different.

| Mean this | Write this | Never these |
|---|---|---|
| The saved artifact a manager creates | projection | ranking model, projection board |
| The ranked output of a projection | player rankings | the sheet |
| The league's categories or point values | scoring settings | scoring system, scoring format |
| Everything else configured about the league | league settings | league config |
| The live drafting feature | Draft Mode | draft board mode, live draft |
| The paid membership | Premium | premium tier, premium plan, Pro plan |
| A place in a roster or lineup | spot | seat, seats |

## Spelling and casing

Matched **case-sensitively**, because here the casing is the whole rule. Everything else is
matched case-insensitively.

| Never this | Write instead |
|---|---|
| Slapstat | SlapStat |
| SlapStats | SlapStat |
| SLAPSTAT | SlapStat |
| Yahoo! | Yahoo |
| ESPN+ | ESPN |
| Draft mode | Draft Mode |
| draft mode | Draft Mode |
| My projections | My Projections |
| My drafts | My Drafts |

Navigation and footer links are title case (*Send Feedback*, *Sign In*), and so are the
names Draft Mode, My Projections, My Drafts and Who's Hot wherever they appear. Buttons, headings and
labels elsewhere stay sentence case.

## Phrases to avoid

| Never this | Write instead |
|---|---|
| ultimate | (cut it) |
| revolutionary | (cut it) |
| game-changer | (cut it) |
| next-level | (cut it) |
| unleash | (cut it) |
| elevate | (cut it) |
| supercharge | (cut it) |
| empower | (cut it) |
| effortless | (cut it) |
| seamless | (cut it) |
| seamlessly | (cut it) |
| powerful insights | say which insight |
| built for winners | (cut it) |
| take your league to the next level | (cut it) |
| say goodbye to | (cut it) |
| we've got you covered | (cut it) |
| let's dive in | (cut it) |
| it's worth noting that | (cut it) |
| in today's fast-paced world | (cut it) |
| designed to help you | say what it does |
| the truth is | (cut it) |
| here's the thing | (cut it) |
| what this means is | (cut it) |
| used to be guesswork | (cut it) |
| utilize | use |
| Something went wrong | name what failed |

*Unlock* is deliberately not on this list: it is what the Premium buttons say, and it names
the thing literally rather than dressing it up.

## Punctuation

| Never | Use instead |
| --- | --- |
| em dash (—) | comma, colon, parentheses, or a new sentence |

## Length

The default is no explanatory text at all (see `CLAUDE.md`, *Copy*). What there is stays under
these caps, counted after collapsing whitespace. A text block is any run of visible text between
two tags; an interpolation counts as one word. The privacy and terms pages are exempt: legal
text is written to be complete.

| Where | At most | Instead |
| --- | --- | --- |
| tooltip | 60 characters | cut it, or rename the label so it needs none |
| text block | 120 characters | one short sentence, or cut it |

## Placeholders

A build writes no copy. Wherever a reader will see text, it leaves a placeholder saying what the
text has to do, and the words are written afterwards, all together, in a copy pass of their own:

```
[[copy: button that saves the league's scoring settings]]
```

The check fails on any placeholder left in `src/` (templates and `.ts`, specs and the generated
client excepted), and no baseline can absorb one, so none merges.

## Scope

The rules above scan Angular templates (`src/app/**/*.html`) only. TypeScript strings are reviewed
by the `copy-check` skill. Placeholders are the exception: they are found in `.ts` files too.

## Baseline

`.github/copy-baseline.json` records the violations already shipping, so this check blocks new
ones without demanding the back catalogue be fixed first. A count may only go down. Regenerate
after fixing copy with `npm run check:copy -- --update`, and commit the smaller baseline in the
same PR.
