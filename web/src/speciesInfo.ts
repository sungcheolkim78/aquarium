/**
 * Species info card + catalog ("도감") DOM (SPEC §4.4 proposal). Pure UI
 * glue, like `settingsPanel.ts` — no storage access; `main.ts` persists
 * observations via `onObserve`. Left out of the automated test suite and
 * verified visually instead, matching `ui.ts`/`settingsPanel.ts`.
 */
import type { FishSpecies } from "./config";
import { countObserved, withObserved, type ObservedSpecies } from "./observations";

export interface SpeciesInfoCallbacks {
  onObserve(speciesId: string): void;
}

export interface SpeciesInfo {
  readonly cardElement: HTMLElement;
  readonly catalogElement: HTMLElement;
  /** Opens the card for this species (replacing its content if already open) and marks it observed. */
  showSpecies(speciesId: string): void;
  /** Closes the card if open; no-op otherwise. */
  closeCard(): void;
  dispose(): void;
}

/** Build the species-info card and catalog list. `registry` drives the catalog (always all species, regardless of visibility settings). */
export function createSpeciesInfo(
  registry: readonly FishSpecies[],
  initialObserved: ObservedSpecies,
  callbacks: SpeciesInfoCallbacks,
): SpeciesInfo {
  let observed = initialObserved;
  const byId = new Map(registry.map((species) => [species.id, species]));
  const cleanups: (() => void)[] = [];

  // Card --------------------------------------------------------------------
  const card = document.createElement("div");
  card.className = "species-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "물고기 정보");

  const cardHeader = document.createElement("div");
  cardHeader.className = "species-card__header";
  const cardName = document.createElement("h2");
  cardName.className = "species-card__name";
  const cardBadge = document.createElement("span");
  cardBadge.className = "species-card__badge";
  cardBadge.textContent = "관찰함";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "species-card__close";
  closeButton.setAttribute("aria-label", "닫기");
  closeButton.textContent = "×";
  const onCloseClick = (): void => closeCardImpl();
  closeButton.addEventListener("click", onCloseClick);
  cleanups.push(() => closeButton.removeEventListener("click", onCloseClick));
  cardHeader.append(cardName, cardBadge, closeButton);

  const cardDescription = document.createElement("p");
  cardDescription.className = "species-card__description";
  card.append(cardHeader, cardDescription);

  // Catalog -------------------------------------------------------------------
  const catalog = document.createElement("div");
  catalog.className = "species-catalog";
  catalog.setAttribute("role", "dialog");
  catalog.setAttribute("aria-label", "도감");

  const catalogHeading = document.createElement("h3");
  catalogHeading.className = "species-catalog__heading";
  const catalogList = document.createElement("ul");
  catalogList.className = "species-catalog__list";
  catalog.append(catalogHeading, catalogList);

  const marks = new Map<string, HTMLSpanElement>();
  for (const species of registry) {
    const row = document.createElement("li");
    row.className = "species-catalog__row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "species-catalog__item";
    const label = document.createElement("span");
    label.textContent = species.label;
    const mark = document.createElement("span");
    mark.className = "species-catalog__mark";
    button.append(label, mark);
    const onClick = (): void => showSpeciesImpl(species.id);
    button.addEventListener("click", onClick);
    cleanups.push(() => button.removeEventListener("click", onClick));
    row.append(button);
    catalogList.append(row);
    marks.set(species.id, mark);
  }

  const refreshCatalog = (): void => {
    catalogHeading.textContent = `도감 (${countObserved(observed, registry)}/${registry.length})`;
    for (const [id, mark] of marks) mark.textContent = observed[id] === true ? "관찰함" : "미관찰";
  };
  refreshCatalog();

  function closeCardImpl(): void {
    card.classList.remove("is-open");
  }

  function showSpeciesImpl(speciesId: string): void {
    const species = byId.get(speciesId);
    if (!species) return;
    cardName.textContent = species.label;
    cardDescription.textContent = species.description;
    observed = withObserved(observed, speciesId);
    callbacks.onObserve(speciesId);
    refreshCatalog();
    card.classList.add("is-open");
  }

  return {
    cardElement: card,
    catalogElement: catalog,
    showSpecies: showSpeciesImpl,
    closeCard: closeCardImpl,
    dispose(): void {
      for (const cleanup of cleanups) cleanup();
      card.remove();
      catalog.remove();
    },
  };
}
