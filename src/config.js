import { google } from 'googleapis';

export const projects = [
  {
    name: 'Furnicuța',
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID_FURNICUTA,
    adAccountId: process.env.META_AD_ACCOUNT_ID_FURNICUTA,
    campaignMapping: [
      { match: 'lead form', block: 'LEAD FORM', resultAction: 'lead' },
      {
        match: 'message',
        block: 'MESSAGES',
        resultAction: 'onsite_conversion.messaging_conversation_started_7d',
      },
    ],
  },
  {
    name: 'Fabrik Home',
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID_FABRIK,
    adAccountId: process.env.META_AD_ACCOUNT_ID_FABRIK,
    campaignMapping: [
      {
        match: 'message',
        block: 'MESSAGE',
        resultAction: 'onsite_conversion.messaging_conversation_started_7d',
      },
      {
        match: 'purchase',
        block: 'PURCHASE',
        resultAction: 'offsite_conversion.fb_pixel_purchase',
        addToCartAction: 'offsite_conversion.fb_pixel_add_to_cart',
      },
    ],
  },
  {
    name: 'MM Cargo',
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID_MMCARGO,
    adAccountId: process.env.META_AD_ACCOUNT_ID_MMCARGO,
    campaignMapping: [
      {
        match: 'lead form',
        block: 'LEAD FORM',
        resultAction: 'lead',
      },
      {
        match: 'message',
        block: 'MESSAGES',
        resultAction: 'onsite_conversion.messaging_conversation_started_7d',
      },
    ],
  },
  {
    name: 'OO.WELL',
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID_OOWELL,
    adAccountId: process.env.META_AD_ACCOUNT_ID_OOWELL,
    campaignMapping: [
      {
        match: 'lead form',
        block: 'LEAD FORM',
        resultAction: 'lead',
      },
      {
        match: 'purchase',
        block: 'PURCHASE',
        resultAction: 'offsite_conversion.fb_pixel_purchase',
      },
      {
        match: 'lead site',
        block: 'Website Lead',
        resultAction: 'offsite_conversion.fb_pixel_lead',
      },
    ],
  },
  {
    name: 'OO.WELL Purchase',
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID_OOWELL,
    adAccountId: process.env.META_AD_ACCOUNT_ID_OOWELL_PURCHASE,
    campaignMapping: [
      {
        match: 'purchase',
        block: 'PURCHASE',
        resultAction: 'offsite_conversion.fb_pixel_purchase',
      },
    ],
  },
  {
    name: 'TOPMAG',
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID_TOPMAG,
    adAccountId: process.env.META_AD_ACCOUNT_ID_TOPMAG,
    campaignMapping: [
      {
        match: 'message',
        block: 'MESSAGE',
        resultAction: 'onsite_conversion.messaging_conversation_started_7d',
      },
      {
        match: 'product',
        block: 'PRODUCT',
        resultAction: 'offsite_conversion.fb_pixel_lead',
      },
      {
        match: 'catalog',
        block: 'CATALOG',
        resultAction: 'offsite_conversion.fb_pixel_lead',
      },
      {
        match: 'purchase',
        block: 'PURCHASE',
        resultAction: 'offsite_conversion.fb_pixel_purchase',
      },
    ],
  },
];

export function getGoogleAuth() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set');
  }
  const json = Buffer.from(b64, 'base64').toString('utf8');
  const credentials = JSON.parse(json);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}
