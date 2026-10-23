# Hardware interface ownership

Baseline: f76f379. Owner: @whyyt. Device routing, parsing and authentication are isolated in hardware-interface/gateway.mjs. Existing hardware implementations, routes, signatures, limits and migrations are unchanged.

Frontend work normally belongs in public/. Hardware modules and shared backend dependencies require hardware review. Run npm run check:hardware, npm run test:hardware and npm test. Never refresh the manifest merely to hide frontend changes.

In GitHub enable required Code Owner approval, required hardware-contract checks, stale approval dismissal and push restrictions. Ensure whyyt has write access. An owner cannot approve their own PR; designate another trusted reviewer when needed. Hashes and CODEOWNERS alone cannot constrain unrestricted write access.

No deployment, flashing, remote settings, commits or pushes were performed. Full Chinese handoff: hardware-interface-boundary.zh-CN.md.
