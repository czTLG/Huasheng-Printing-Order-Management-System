# Matrix Thailand Food Route Design

**Date:** 2026-07-28  
**Status:** Approved in conversation

## Goal

Allow the existing route-readiness and strategy-match gates to recognize the
deployed Thai food and snack buyer journey for Thai spice, seasoning, snack,
nut, and dried-food manufacturers.

## Scope

Add one deterministic `thailand_food` route profile for country `TH`. It uses:

- `/th`
- `/th/about`
- `/th/markets/thailand`
- `/th/applications/snack-packaging`
- `/th/products/food-packaging-roll-film`

The profile expects Thai content and uses a short Thai courtesy closing. It is
selected only when the country is Thailand and at least one evidenced category
matches spices, seasonings, snacks, nuts, dried fruit, fried vegetables, or
similar dry-food categories.

The existing Thai `liquid_care` profile retains precedence for liquid detergent,
personal-care, and home-care categories.

## Safety and Gates

- No score threshold, evidence requirement, approval requirement, recipient
  rule, duplicate rule, or sending rule changes.
- The five public routes must pass the existing production route verifier.
- The route profile must match the reviewed intake route ID, language, and
  canonical URLs byte-for-byte.
- This change creates no draft and sends no message by itself.
- Nithi Foods may continue only after the profile tests and production route
  checks pass.

## Verification

Tests prove:

- Thai seasoning categories select `thailand_food`.
- Thai snack and fried-vegetable categories select `thailand_food`.
- Thai liquid-care categories still select `liquid_care`.
- Non-Thai seasoning candidates do not inherit the profile.
- The five exact routes and Thai language are returned.
- Production URLs return HTTP 200 and the application page exposes the expected
  Thai canonical page.

After deployment, the Nithi draft gate must recalculate from the current
official evidence and return no strategy or route blocker before any approval
or send operation occurs.

