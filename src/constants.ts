/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const BATTERY_MODELS = [
  "DIN36", "DIN44", "D50", "DIN 55", "TD70", "DIN66", "DIN74", "DIN 88", 
  "TD90", "TD 100", "N50", "N50Z", "NS70", "N70", "N70 Z", "N80", 
  "N80 Z", "N90", "N100", "NS40TOK", "NS40", "NS40Z", "N40", "NS60", 
  "N110", "N120", "N135", "N150", "N180", "N200", "65D23"
] as const;

export const BATTERY_CODE_MAPPING: Record<string, string> = {
  "1": "DIN36", "2": "DIN44", "3": "D50", "4": "DIN 55", "5": "TD70",
  "6": "DIN66", "7": "DIN74", "8": "DIN 88", "9": "TD90", "10": "TD 100",
  "11": "N50", "12": "N50Z", "13": "NS70", "14": "N70", "15": "N70 Z",
  "16": "N80", "17": "N80 Z", "18": "N90", "19": "N100", "20": "NS40TOK",
  "21": "NS40", "22": "NS40Z", "23": "N40", "24": "NS60", "25": "N110",
  "26": "N120", "27": "N135", "28": "N150", "29": "N180", "30": "N200",
  "31": "N200", "32": "65D23"
};

export type BatteryModel = typeof BATTERY_MODELS[number];

export interface ReportSection {
  density: string;
  model: string;
  temp: string;
}

export interface ReportData {
  fillingAcid: ReportSection & { enabled: boolean };
  afterCharging: ReportSection;
  levelAdjustment: { density: string; temp: string };
  generalDensity: ReportSection;
}
