/**
 * Verified NLM RxNorm concepts for offline normalization and duplicate tests.
 * CUIs and names were checked against rxnav.nlm.nih.gov getDrugs / related APIs.
 * Do not invent RxCUIs.
 */

export type FixtureConcept = {
  rxCui: string;
  name: string;
  synonym?: string;
  tty: "SCD" | "SBD" | "GPCK" | "BPCK";
  clinicalDrugRxCui: string;
  clinicalDrugName: string;
  ingredientRxCuis: string[];
  ingredientNames: string[];
  strengthValue: string;
  strengthUnit: string;
  dosageForm: string;
  /** Empty when immediate-release / not characterized as extended. */
  releaseCharacteristic: string;
  brandName?: string;
};

/** Terminology version string observed from NLM REST /version.json during fixture capture. */
export const RXNORM_FIXTURE_VERSION = "05-Oct-2026";
export const RXNORM_FIXTURE_DATE = "2026-10-22";

export const RXNORM_FIXTURES: FixtureConcept[] = [
  {
    rxCui: "1364445",
    name: "apixaban 5 MG Oral Tablet",
    tty: "SCD",
    clinicalDrugRxCui: "1364445",
    clinicalDrugName: "apixaban 5 MG Oral Tablet",
    ingredientRxCuis: ["1364430"],
    ingredientNames: ["apixaban"],
    strengthValue: "5",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
  },
  {
    rxCui: "1364447",
    name: "apixaban 5 MG Oral Tablet [Eliquis]",
    synonym: "Eliquis 5 MG Oral Tablet",
    tty: "SBD",
    clinicalDrugRxCui: "1364445",
    clinicalDrugName: "apixaban 5 MG Oral Tablet",
    ingredientRxCuis: ["1364430"],
    ingredientNames: ["apixaban"],
    strengthValue: "5",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
    brandName: "Eliquis",
  },
  {
    rxCui: "1364435",
    name: "apixaban 2.5 MG Oral Tablet",
    tty: "SCD",
    clinicalDrugRxCui: "1364435",
    clinicalDrugName: "apixaban 2.5 MG Oral Tablet",
    ingredientRxCuis: ["1364430"],
    ingredientNames: ["apixaban"],
    strengthValue: "2.5",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
  },
  {
    rxCui: "1364441",
    name: "apixaban 2.5 MG Oral Tablet [Eliquis]",
    synonym: "Eliquis 2.5 MG Oral Tablet",
    tty: "SBD",
    clinicalDrugRxCui: "1364435",
    clinicalDrugName: "apixaban 2.5 MG Oral Tablet",
    ingredientRxCuis: ["1364430"],
    ingredientNames: ["apixaban"],
    strengthValue: "2.5",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
    brandName: "Eliquis",
  },
  {
    rxCui: "866514",
    name: "metoprolol tartrate 50 MG Oral Tablet",
    tty: "SCD",
    clinicalDrugRxCui: "866514",
    clinicalDrugName: "metoprolol tartrate 50 MG Oral Tablet",
    ingredientRxCuis: ["6918"],
    ingredientNames: ["metoprolol"],
    strengthValue: "50",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
  },
  {
    rxCui: "866516",
    name: "metoprolol tartrate 50 MG Oral Tablet [Lopressor]",
    synonym: "Lopressor 50 MG Oral Tablet",
    tty: "SBD",
    clinicalDrugRxCui: "866514",
    clinicalDrugName: "metoprolol tartrate 50 MG Oral Tablet",
    ingredientRxCuis: ["6918"],
    ingredientNames: ["metoprolol"],
    strengthValue: "50",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
    brandName: "Lopressor",
  },
  {
    rxCui: "866436",
    name: "24 HR metoprolol succinate 50 MG Extended Release Oral Tablet",
    synonym: "metoprolol succinate 50 MG 24 HR Extended Release Oral Tablet",
    tty: "SCD",
    clinicalDrugRxCui: "866436",
    clinicalDrugName: "24 HR metoprolol succinate 50 MG Extended Release Oral Tablet",
    ingredientRxCuis: ["6918"],
    ingredientNames: ["metoprolol"],
    strengthValue: "50",
    strengthUnit: "MG",
    dosageForm: "Extended Release Oral Tablet",
    releaseCharacteristic: "24 HR Extended Release",
  },
  {
    rxCui: "866438",
    name: "24 HR metoprolol succinate 50 MG Extended Release Oral Tablet [Toprol]",
    synonym: "24 HR Toprol 50 MG Extended Release Oral Tablet",
    tty: "SBD",
    clinicalDrugRxCui: "866436",
    clinicalDrugName: "24 HR metoprolol succinate 50 MG Extended Release Oral Tablet",
    ingredientRxCuis: ["6918"],
    ingredientNames: ["metoprolol"],
    strengthValue: "50",
    strengthUnit: "MG",
    dosageForm: "Extended Release Oral Tablet",
    releaseCharacteristic: "24 HR Extended Release",
    brandName: "Toprol",
  },
  {
    rxCui: "243670",
    name: "aspirin 81 MG Oral Tablet",
    tty: "SCD",
    clinicalDrugRxCui: "243670",
    clinicalDrugName: "aspirin 81 MG Oral Tablet",
    ingredientRxCuis: ["1191"],
    ingredientNames: ["aspirin"],
    strengthValue: "81",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
  },
  {
    rxCui: "866482",
    name: "hydrochlorothiazide 25 MG / metoprolol tartrate 50 MG Oral Tablet",
    synonym: "HCTZ 25 MG / metoprolol tartrate 50 MG Oral Tablet",
    tty: "SCD",
    clinicalDrugRxCui: "866482",
    clinicalDrugName: "hydrochlorothiazide 25 MG / metoprolol tartrate 50 MG Oral Tablet",
    ingredientRxCuis: ["5487", "6918"],
    ingredientNames: ["hydrochlorothiazide", "metoprolol"],
    strengthValue: "25/50",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
  },
  {
    rxCui: "866502",
    name: "hydrochlorothiazide 25 MG / metoprolol tartrate 50 MG Oral Tablet [Lopressor HCT]",
    synonym: "Lopressor HCT 50/25 Oral Tablet",
    tty: "SBD",
    clinicalDrugRxCui: "866482",
    clinicalDrugName: "hydrochlorothiazide 25 MG / metoprolol tartrate 50 MG Oral Tablet",
    ingredientRxCuis: ["5487", "6918"],
    ingredientNames: ["hydrochlorothiazide", "metoprolol"],
    strengthValue: "25/50",
    strengthUnit: "MG",
    dosageForm: "Oral Tablet",
    releaseCharacteristic: "",
    brandName: "Lopressor HCT",
  },
];

export function fixtureByRxCui(rxCui: string): FixtureConcept | undefined {
  return RXNORM_FIXTURES.find((c) => c.rxCui === rxCui);
}
