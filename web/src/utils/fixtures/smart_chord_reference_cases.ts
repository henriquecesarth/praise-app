import corpus from '../../../../shared/fixtures/music-theory-v1.json';

/** Original synthetic examples; expectations are preserved in the shared JSON. */
export interface NotationReferenceCase { id: string; source: string; expectedPlusTwo: string; unicode?: boolean; }
export const NOTATION_REFERENCE_CASES: NotationReferenceCase[] = corpus.legacyNotation;
