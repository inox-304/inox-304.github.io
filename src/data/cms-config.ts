// Public published-sheet URLs only. No Google credentials or private tokens belong here.
export const cmsConfig = {
  catalogUrl: import.meta.env.PUBLIC_CMS_CATALOG_URL || '',
  contactsUrl: import.meta.env.PUBLIC_CMS_CONTACTS_URL || '',
  settingsUrl: import.meta.env.PUBLIC_CMS_SETTINGS_URL || '',
};
