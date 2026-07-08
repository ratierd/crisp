# AG-UI events cross the hexagon untranslated

The architecture is hexagonal (domain entities and ports in `libs/domain`, adapters in `apps/server`), but AG-UI streaming events are allowed to cross port boundaries untranslated instead of being mapped to domain-owned event types. AG-UI is an open protocol spec, not a vendor SDK type, so treating it as the lingua franca keeps the swap-ability that motivated the hexagon (any Model behind `ModelGateway`) while avoiding a bidirectional translation layer in the riskiest code path — stream handling. Strict purity (domain-owned event types) was rejected as busywork with real bug surface.

Status: accepted
