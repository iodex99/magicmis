/**
 * GST state codes.
 *
 * Source: the GST e-invoice portal's State Code master table,
 * https://einvoice1.gst.gov.in/Others/MasterCodes (verified 2026-09-13).
 *
 * Needed at signup because SPEC §13 derives place of supply from the buyer's billing
 * state (or their GSTIN's leading two digits). Code 28 does not appear in the master and
 * is not listed. 96 and 99 (other countries) are omitted: SPEC §2.14 is INR-only and the
 * product sells to Indian businesses.
 *
 * Codes 25 (Daman and Diu) and 26 (Dadra and Nagar Haveli) are both kept because the
 * master lists both, even though the two UTs were merged in 2020 -- a customer whose
 * GSTIN still carries either code must be able to sign up.
 */

export const GST_STATE_CODES = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
} as const;

export type GstStateCode = keyof typeof GST_STATE_CODES;

export const isGstStateCode = (value: string): value is GstStateCode =>
  Object.prototype.hasOwnProperty.call(GST_STATE_CODES, value);
