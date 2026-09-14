export const generateEventCode = () => {
  const randomString = Math.random().toString(36).substring(2, 15).toUpperCase();
  return `#EVT_${randomString}`;
};

export const generateOrganizerCode = () => {
  const randomString = Math.random().toString(36).substring(2, 15).toUpperCase();
  return `#ORGNSR_${randomString}`;
};

export const generateTicketCode = () => {
  const randomString = Math.random().toString(36).substring(2, 15).toUpperCase();
  return `#TKT_${randomString}`;
};

export const generateMemberCode = () => {
  const randomString = Math.random().toString(36).substring(2, 15).toUpperCase();
  return `#MBR_${randomString}`;
};
