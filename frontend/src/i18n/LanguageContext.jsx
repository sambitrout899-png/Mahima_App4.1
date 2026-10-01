import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getMyPreferredLanguage, listEnabledLanguages, updateMyPreferredLanguage } from "../api/languagesApi";
import { getToken } from "../features/auth/authService";
import { apiFetch } from "../utils/fetch-auth-shim";

export const REQUIRED_UI_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", isDefault: true, enabled: true, displayOrder: 10, rtl: false },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", isDefault: false, enabled: true, displayOrder: 20, rtl: false },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", isDefault: false, enabled: true, displayOrder: 30, rtl: false },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", isDefault: false, enabled: true, displayOrder: 40, rtl: false },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", isDefault: false, enabled: true, displayOrder: 50, rtl: false },
  { code: "mr", name: "Marathi", nativeName: "मराठी", isDefault: false, enabled: true, displayOrder: 60, rtl: false },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", isDefault: false, enabled: true, displayOrder: 70, rtl: false },
];

const dictionaries = {
  en: {
    "layout.language": "Language",
    "layout.openMenu": "Open menu",
    "layout.closeMenu": "Close menu",
    "layout.openPastor": "Open AI Counseller",
    "layout.openChat": "Open chat",
    "layout.notifications": "Notifications",
    "layout.profile": "Profile photo & status",
    "layout.logout": "Log out",
    "layout.logoutSwitch": "Log out / switch account",
    "layout.collapse": "Collapse",
    "layout.expand": "Expand",
    "layout.profileTitle": "Profile",
    "layout.profileSubtitle": "Update your display photo and WhatsApp-style status.",
    "layout.uploadDp": "Upload DP",
    "layout.photoHint": "Square photos look best in chat and the app header.",
    "layout.displayName": "Display name",
    "layout.status": "Status",
    "layout.statusPlaceholder": "Available, praying, serving, or a short testimony...",
    "layout.cancel": "Cancel",
    "layout.save": "Save",
    "layout.profileUpdated": "Profile updated.",
    "layout.profileLoadFailed": "Could not load profile. You can still update and save.",
    "layout.profileSaveFailed": "Could not save profile.",
    "nav.general": "General",
    "nav.community": "Community",
    "nav.operations": "Operations",
    "nav.ministry": "Ministry",
    "nav.admin": "Admin",
    "nav.home": "Home",
    "nav.aiPastor": "AI Counseller",
    "nav.readMe": "ReadMe",
    "nav.appDownloads": "App Downloads",
    "nav.sermons": "Sermons",
    "nav.prayerRequests": "Prayer Requests",
    "nav.tasks": "Tasks",
    "nav.users": "Users",
    "nav.teams": "Teams",
    "nav.roles": "Roles",
    "nav.pages": "Pages",
    "nav.attendance": "Attendance",
    "nav.payroll": "Payroll",
    "nav.costs": "Costs",
    "nav.marriage": "Marriage",
    "nav.baptism": "Baptism",
    "nav.counselling": "Counselling",
    "nav.adminDashboard": "Admin Dashboard",
    "nav.liveUsers": "Live Users",
    "nav.messageCenter": "Message Center",
    "nav.languages": "Languages",
    "nav.emailClient": "Email Client",
    "nav.googleDrive": "Google Drive",
    "nav.serverFiles": "Server Files",
    "common.addUser": "Add User",
    "common.refresh": "Refresh",
    "common.search": "Search",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.download": "Download",
    "common.upload": "Upload",
    "common.send": "Send",
    "common.close": "Close",
    "common.loading": "Loading",
    "common.retry": "Retry",
    "common.noData": "No data",
    "common.actions": "Actions",
    "common.status": "Status",
    "common.role": "Role",
    "common.name": "Name",
    "common.email": "Email",
    "common.phone": "Phone",
    "common.date": "Date",
    "common.prev": "Prev",
    "common.next": "Next",
    "common.clear": "Clear",
    "common.done": "Done",
    "common.reset": "Reset",
    "common.add": "Add",
    "common.remove": "Remove",
    "common.back": "Back",
    "common.showing": "Showing",
    "common.of": "of",
    "common.select": "Select",
    "common.any": "Any",
    "common.yes": "Yes",
    "common.no": "No",
    "common.ascending": "Ascending",
    "common.descending": "Descending",
    "common.relevance": "Relevance",
    "common.joinDate": "Join date",
    "common.noDataFound": "No data found.",
    "page.users.title": "Users",
    "page.users.subtitle": "Manage members, contact details, roles, and ministry messages.",
    "page.users.editUser": "Edit User",
    "page.users.searchPlaceholder": "Search name, email, phone, role, code...",
    "page.users.noUsersFound": "No users found.",
    "page.users.searchFilters": "Search Filters",
    "page.users.profileDetails": "Profile Details",
    "page.users.userPhoto": "User Photo",
    "page.users.uploadPhoto": "Upload photo",
    "page.users.uploading": "Uploading...",
    "page.users.remove": "Remove",
    "page.users.welcomeBroadcast": "Welcome broadcast",
    "page.users.dailyWordBroadcast": "Daily Word broadcast",
    "page.users.meetingBroadcast": "Meeting broadcast",
    "page.users.message": "Message",
    "page.users.channels": "Channels",
    "page.users.recipients": "Recipients",
    "page.users.filterRecipients": "Filter recipients...",
    "page.users.selectAll": "Select All",
    "page.users.loadingRecipients": "Loading recipients...",
    "page.users.noRecipientsFound": "No recipients found.",
    "page.users.generating": "Generate password",
    "page.users.copyId": "Copy Mahima ID",
    "page.users.joined": "Joined",
    "page.users.primaryPosition": "Primary position",
    "form.displayName": "Display Name",
    "form.username": "Username",
    "form.password": "Password",
    "form.role": "Role",
    "form.email": "Email",
    "form.phone": "Phone",
    "form.joinDate": "Join Date",
    "form.birthday": "Birthday",
    "form.maritalStatus": "Marital Status",
    "form.sex": "Sex",
    "form.age": "Age",
    "form.aadharNumber": "Aadhar Number",
    "form.homeAddress": "Home Address",
    "form.currentAddress": "Current Address",
    "form.emergencyPhone": "Emergency Phone",
    "form.baptismDate": "Baptism Date",
    "form.baptismPlace": "Baptism Place",
    "form.mahimaId": "Mahima ID",
    "form.primaryPosition": "Primary Position",
    "form.notAssigned": "Not assigned",
    "form.isBaptized": "Is Baptized",
    "form.isBornAgain": "Is Born Again",
    "form.isBeliever": "Is Believer",
    "form.isPastor": "Is Pastor",
    "form.payrollEnabled": "Payroll Enabled",
    "form.keepCurrentPassword": "Leave blank to keep current",
    "form.passwordRequired": "Required",
    "filter.anyRole": "Any role",
    "filter.anyContact": "Any contact",
    "filter.hasEmail": "Has email",
    "filter.hasPhone": "Has phone",
    "filter.missingEmail": "Missing email",
    "filter.missingPhone": "Missing phone",
    "filter.male": "Male",
    "filter.female": "Female",
    "filter.joinedFrom": "Joined From",
    "filter.joinedTo": "Joined To",
    "filter.sortBy": "Sort By",
    "filter.sortDir": "Sort Direction",
    "filter.contact": "Contact",
    "filter.hasId": "Has ID",
    "filter.missingId": "Missing ID",
    "filter.pastor": "Pastor",
    "filter.baptized": "Baptized",
    "filter.bornAgain": "Born Again",
    "filter.believer": "Believer",
    "filter.single": "Single",
    "filter.married": "Married",
    "filter.divorced": "Divorced",
    "filter.widowed": "Widowed",
    "page.members.title": "Team Members",
    "page.members.subtitle": "Manage members, roles, and the team leader.",
    "page.members.addMember": "Add Member",
    "page.members.selectedUser": "Selected user",
    "page.members.chooseUserBelow": "Choose a user below",
    "page.members.optionalRole": "Optional role",
    "page.members.markLeader": "Mark as leader",
    "page.members.searchUsers": "Search users by name, email, or username",
    "page.members.leader": "Leader",
    "page.members.joined": "Joined",
    "page.members.members": "Members",
    "page.members.loadingMembers": "Loading members...",
    "page.members.noMembers": "No members yet. Add a member to begin.",
    "page.members.loadingUsers": "Loading users...",
    "page.members.noUsers": "No users found.",
    "page.members.editRole": "Edit role",
    "page.members.setLeader": "Make leader",
    "page.members.unsetLeader": "Unset leader",
    "page.members.removeMember": "Remove member",
    "page.members.addUser": "Add user",
    "page.members.useUser": "Use user",
    "page.members.refreshTeams": "Refresh teams",
    "page.members.alreadyInTeam": "Already in team",
    "page.members.refreshMembers": "Refresh members",
    "page.members.back": "Back",
  },
  ne: {
    "layout.language": "भाषा",
    "layout.openMenu": "मेनु खोल्नुहोस्",
    "layout.closeMenu": "मेनु बन्द गर्नुहोस्",
    "layout.openPastor": "AI पास्टर खोल्नुहोस्",
    "layout.openChat": "च्याट खोल्नुहोस्",
    "layout.notifications": "सूचनाहरू",
    "layout.profile": "प्रोफाइल फोटो र स्थिति",
    "layout.logout": "लग आउट",
    "layout.logoutSwitch": "लग आउट / खाता बदल्नुहोस्",
    "layout.collapse": "खुम्च्याउनुहोस्",
    "layout.expand": "फैलाउनुहोस्",
    "layout.profileTitle": "प्रोफाइल",
    "layout.profileSubtitle": "आफ्नो फोटो र WhatsApp-जस्तो स्थिति अपडेट गर्नुहोस्।",
    "layout.uploadDp": "फोटो अपलोड गर्नुहोस्",
    "layout.photoHint": "च्याट र एप हेडरमा चौकोर फोटो राम्रो देखिन्छ।",
    "layout.displayName": "देखिने नाम",
    "layout.status": "स्थिति",
    "layout.statusPlaceholder": "उपलब्ध, प्रार्थनामा, सेवामा, वा छोटो गवाही...",
    "layout.cancel": "रद्द गर्नुहोस्",
    "layout.save": "सुरक्षित गर्नुहोस्",
    "layout.profileUpdated": "प्रोफाइल अपडेट भयो।",
    "layout.profileLoadFailed": "प्रोफाइल लोड हुन सकेन। तपाईं अझै अपडेट गरेर सुरक्षित गर्न सक्नुहुन्छ।",
    "layout.profileSaveFailed": "प्रोफाइल सुरक्षित हुन सकेन।",
    "nav.general": "सामान्य",
    "nav.community": "समुदाय",
    "nav.operations": "सञ्चालन",
    "nav.ministry": "मिनिस्ट्री",
    "nav.admin": "एडमिन",
    "nav.home": "गृह",
    "nav.aiPastor": "AI पास्टर",
    "nav.readMe": "रिडमी",
    "nav.appDownloads": "एप डाउनलोड",
    "nav.sermons": "प्रवचनहरू",
    "nav.prayerRequests": "प्रार्थना अनुरोधहरू",
    "nav.tasks": "कार्यहरू",
    "nav.users": "प्रयोगकर्ताहरू",
    "nav.teams": "टोलीहरू",
    "nav.roles": "भूमिकाहरू",
    "nav.pages": "पृष्ठहरू",
    "nav.attendance": "उपस्थिति",
    "nav.payroll": "पेरोल",
    "nav.costs": "खर्च",
    "nav.marriage": "विवाह",
    "nav.baptism": "बप्तिस्मा",
    "nav.counselling": "परामर्श",
    "nav.adminDashboard": "एडमिन ड्यासबोर्ड",
    "nav.liveUsers": "लाइभ प्रयोगकर्ताहरू",
    "nav.messageCenter": "सन्देश केन्द्र",
    "nav.languages": "भाषाहरू",
    "nav.emailClient": "इमेल क्लाइन्ट",
    "nav.googleDrive": "गुगल ड्राइभ",
    "nav.serverFiles": "सर्भर फाइलहरू",
    "common.addUser": "प्रयोगकर्ता थप्नुहोस्",
    "common.refresh": "रिफ्रेस",
    "common.search": "खोज्नुहोस्",
    "common.cancel": "रद्द गर्नुहोस्",
    "common.save": "सुरक्षित गर्नुहोस्",
    "common.delete": "मेटाउनुहोस्",
    "common.edit": "सम्पादन गर्नुहोस्",
    "common.download": "डाउनलोड",
    "common.upload": "अपलोड",
    "common.send": "पठाउनुहोस्",
    "common.close": "बन्द गर्नुहोस्",
    "common.loading": "लोड हुँदैछ",
    "common.retry": "फेरि प्रयास गर्नुहोस्",
    "common.noData": "डाटा छैन",
    "common.actions": "कार्यहरू",
    "common.status": "स्थिति",
    "common.role": "भूमिका",
    "common.name": "नाम",
    "common.email": "इमेल",
    "common.phone": "फोन",
    "common.date": "मिति",
    "common.prev": "अघिल्लो",
    "common.next": "अर्को",
    "common.clear": "सफा गर्नुहोस्",
    "common.done": "सम्पन्न",
    "common.reset": "रिसेट",
    "common.add": "थप्नुहोस्",
    "common.remove": "हटाउनुहोस्",
    "common.back": "पछि",
    "common.showing": "देखाउँदैछ",
    "common.of": "को",
    "common.select": "छान्नुहोस्",
    "common.any": "जुनसुकै",
    "common.yes": "हो",
    "common.no": "होइन",
    "common.ascending": "बढ्दो",
    "common.descending": "घट्दो",
    "common.relevance": "सान्दर्भिकता",
    "common.joinDate": "सामेल मिति",
    "common.noDataFound": "कुनै डाटा फेला परेन।",
    "page.users.title": "प्रयोगकर्ताहरू",
    "page.users.subtitle": "सदस्यहरू, सम्पर्क विवरण, भूमिकाहरू र मन्त्रालय सन्देशहरू व्यवस्थापन गर्नुहोस्।",
    "page.users.editUser": "प्रयोगकर्ता सम्पादन",
    "page.users.searchPlaceholder": "नाम, इमेल, फोन, भूमिका, कोड खोज्नुहोस्...",
    "page.users.noUsersFound": "कोई प्रयोगकर्ता फेला परेन।",
    "page.users.searchFilters": "खोज फिल्टर",
    "page.users.profileDetails": "प्रोफाइल विवरण",
    "page.users.userPhoto": "प्रयोगकर्ता फोटो",
    "page.users.uploadPhoto": "फोटो अपलोड गर्नुहोस्",
    "page.users.uploading": "अपलोड हुँदैछ...",
    "page.users.remove": "हटाउनुहोस्",
    "page.users.welcomeBroadcast": "स्वागत सन्देश",
    "page.users.dailyWordBroadcast": "दैनिक वचन सन्देश",
    "page.users.meetingBroadcast": "बैठक सन्देश",
    "page.users.message": "सन्देश",
    "page.users.channels": "च्यानलहरू",
    "page.users.recipients": "प्राप्तकर्ताहरू",
    "page.users.filterRecipients": "प्राप्तकर्ता फिल्टर गर्नुहोस्...",
    "page.users.selectAll": "सबै छान्नुहोस्",
    "page.users.loadingRecipients": "प्राप्तकर्ता लोड हुँदैछ...",
    "page.users.noRecipientsFound": "कोई प्राप्तकर्ता फेला परेन।",
    "page.users.generating": "पासवर्ड बनाउनुहोस्",
    "page.users.copyId": "महिमा आईडी कपी गर्नुहोस्",
    "page.users.joined": "सामेल भएको",
    "page.users.primaryPosition": "प्राथमिक पद",
    "form.displayName": "देखिने नाम",
    "form.username": "प्रयोगकर्ता नाम",
    "form.password": "पासवर्ड",
    "form.role": "भूमिका",
    "form.email": "इमेल",
    "form.phone": "फोन",
    "form.joinDate": "सामेल मिति",
    "form.birthday": "जन्मदिन",
    "form.maritalStatus": "वैवाहिक अवस्था",
    "form.sex": "लिंग",
    "form.age": "उमेर",
    "form.aadharNumber": "आधार नम्बर",
    "form.homeAddress": "घरको ठेगाना",
    "form.currentAddress": "हालको ठेगाना",
    "form.emergencyPhone": "आपतकालीन फोन",
    "form.baptismDate": "बप्तिस्माको मिति",
    "form.baptismPlace": "बप्तिस्माको ठाउँ",
    "form.mahimaId": "महिमा आईडी",
    "form.primaryPosition": "प्राथमिक पद",
    "form.notAssigned": "तोकिएको छैन",
    "form.isBaptized": "बप्तिस्मा भएको",
    "form.isBornAgain": "पुनर्जन्म भएको",
    "form.isBeliever": "विश्वासी छ",
    "form.isPastor": "पास्टर हो",
    "form.payrollEnabled": "पेरोल सक्षम",
    "form.keepCurrentPassword": "खाली छोड्नुहोस् वर्तमान राख्न",
    "form.passwordRequired": "आवश्यक",
    "filter.anyRole": "जुनसुकै भूमिका",
    "filter.anyContact": "जुनसुकै सम्पर्क",
    "filter.hasEmail": "इमेल छ",
    "filter.hasPhone": "फोन छ",
    "filter.missingEmail": "इमेल छैन",
    "filter.missingPhone": "फोन छैन",
    "filter.male": "पुरुष",
    "filter.female": "महिला",
    "filter.joinedFrom": "देखि सामेल",
    "filter.joinedTo": "सम्म सामेल",
    "filter.sortBy": "क्रमबद्ध गर्नुहोस्",
    "filter.sortDir": "क्रमबद्ध दिशा",
    "filter.contact": "सम्पर्क",
    "filter.hasId": "आईडी छ",
    "filter.missingId": "आईडी छैन",
    "filter.pastor": "पास्टर",
    "filter.baptized": "बप्तिस्मा",
    "filter.bornAgain": "पुनर्जन्म",
    "filter.believer": "विश्वासी",
    "filter.single": "अविवाहित",
    "filter.married": "विवाहित",
    "filter.divorced": "विवाह विच्छेद",
    "filter.widowed": "विधवा/विधुर",
    "page.members.title": "टोली सदस्यहरू",
    "page.members.subtitle": "सदस्यहरू, भूमिकाहरू र टोली नेतालाई व्यवस्थापन गर्नुहोस्।",
    "page.members.addMember": "सदस्य थप्नुहोस्",
    "page.members.selectedUser": "छानिएको प्रयोगकर्ता",
    "page.members.chooseUserBelow": "तलबाट प्रयोगकर्ता छान्नुहोस्",
    "page.members.optionalRole": "वैकल्पिक भूमिका",
    "page.members.markLeader": "नेताको रूपमा चिह्नित गर्नुहोस्",
    "page.members.searchUsers": "नाम, इमेल वा प्रयोगकर्ता नामद्वारा खोज्नुहोस्",
    "page.members.leader": "नेता",
    "page.members.joined": "सामेल भएको",
    "page.members.members": "सदस्यहरू",
    "page.members.loadingMembers": "सदस्य लोड हुँदैछ...",
    "page.members.noMembers": "अझै कुनै सदस्य छैन। सुरु गर्न सदस्य थप्नुहोस्।",
    "page.members.loadingUsers": "प्रयोगकर्ता लोड हुँदैछ...",
    "page.members.noUsers": "कोई प्रयोगकर्ता फेला परेन।",
    "page.members.editRole": "भूमिका सम्पादन",
    "page.members.setLeader": "नेता बनाउनुहोस्",
    "page.members.unsetLeader": "नेता हटाउनुहोस्",
    "page.members.removeMember": "सदस्य हटाउनुहोस्",
    "page.members.addUser": "प्रयोगकर्ता थप्नुहोस्",
    "page.members.useUser": "प्रयोगकर्ता प्रयोग गर्नुहोस्",
    "page.members.refreshTeams": "टोली ताजा गर्नुहोस्",
    "page.members.alreadyInTeam": "पहिल्यै टोलीमा छ",
    "page.members.refreshMembers": "सदस्य ताजा गर्नुहोस्",
    "page.members.back": "पछि",
  },
  hi: {
    "layout.language": "भाषा",
    "layout.openMenu": "मेनू खोलें",
    "layout.closeMenu": "मेनू बंद करें",
    "layout.openPastor": "AI पास्टर खोलें",
    "layout.openChat": "चैट खोलें",
    "layout.notifications": "सूचनाएं",
    "layout.profile": "प्रोफ़ाइल फोटो और स्टेटस",
    "layout.logout": "लॉग आउट",
    "layout.logoutSwitch": "लॉग आउट / खाता बदलें",
    "layout.collapse": "समेटें",
    "layout.expand": "फैलाएं",
    "layout.profileTitle": "प्रोफ़ाइल",
    "layout.profileSubtitle": "अपनी फोटो और WhatsApp जैसा स्टेटस अपडेट करें।",
    "layout.uploadDp": "फोटो अपलोड करें",
    "layout.photoHint": "चैट और ऐप हेडर में चौकोर फोटो सबसे अच्छी दिखती है।",
    "layout.displayName": "प्रदर्शित नाम",
    "layout.status": "स्टेटस",
    "layout.statusPlaceholder": "उपलब्ध, प्रार्थना में, सेवा में, या छोटी गवाही...",
    "layout.cancel": "रद्द करें",
    "layout.save": "सेव करें",
    "layout.profileUpdated": "प्रोफ़ाइल अपडेट हो गई।",
    "layout.profileLoadFailed": "प्रोफ़ाइल लोड नहीं हुई। आप फिर भी अपडेट करके सेव कर सकते हैं।",
    "layout.profileSaveFailed": "प्रोफ़ाइल सेव नहीं हो सकी।",
    "nav.general": "सामान्य",
    "nav.community": "समुदाय",
    "nav.operations": "संचालन",
    "nav.ministry": "मिनिस्ट्री",
    "nav.admin": "एडमिन",
    "nav.home": "होम",
    "nav.aiPastor": "AI पास्टर",
    "nav.readMe": "रीड मी",
    "nav.appDownloads": "ऐप डाउनलोड",
    "nav.sermons": "संदेश",
    "nav.prayerRequests": "प्रार्थना निवेदन",
    "nav.tasks": "कार्य",
    "nav.users": "यूज़र",
    "nav.teams": "टीम",
    "nav.roles": "भूमिकाएं",
    "nav.pages": "पेज",
    "nav.attendance": "उपस्थिति",
    "nav.payroll": "पेरोल",
    "nav.costs": "खर्च",
    "nav.marriage": "विवाह",
    "nav.baptism": "बपतिस्मा",
    "nav.counselling": "काउंसलिंग",
    "nav.adminDashboard": "एडमिन डैशबोर्ड",
    "nav.liveUsers": "लाइव यूज़र",
    "nav.messageCenter": "मैसेज सेंटर",
    "nav.languages": "भाषाएं",
    "nav.emailClient": "ईमेल क्लाइंट",
    "nav.googleDrive": "गूगल ड्राइव",
    "nav.serverFiles": "सर्वर फाइलें",
    "common.addUser": "यूज़र जोड़ें",
    "common.refresh": "रीफ्रेश",
    "common.search": "खोजें",
    "common.cancel": "रद्द करें",
    "common.save": "सेव करें",
    "common.delete": "हटाएं",
    "common.edit": "संपादित करें",
    "common.download": "डाउनलोड",
    "common.upload": "अपलोड",
    "common.send": "भेजें",
    "common.close": "बंद करें",
    "common.loading": "लोड हो रहा है",
    "common.retry": "फिर कोशिश करें",
    "common.noData": "कोई डेटा नहीं",
    "common.actions": "कार्यवाही",
    "common.status": "स्थिति",
    "common.role": "भूमिका",
    "common.name": "नाम",
    "common.email": "ईमेल",
    "common.phone": "फोन",
    "common.date": "तारीख",
    "common.prev": "पिछला",
    "common.next": "अगला",
    "common.clear": "साफ करें",
    "common.done": "हो गया",
    "common.reset": "रीसेट",
    "common.add": "जोड़ें",
    "common.remove": "हटाएं",
    "common.back": "वापस",
    "common.showing": "दिखा रहे हैं",
    "common.of": "में से",
    "common.select": "चुनें",
    "common.any": "कोई भी",
    "common.yes": "हाँ",
    "common.no": "नहीं",
    "common.ascending": "आरोही",
    "common.descending": "अवरोही",
    "common.relevance": "प्रासंगिकता",
    "common.joinDate": "शामिल तारीख",
    "common.noDataFound": "कोई डेटा नहीं मिला।",
    "page.users.title": "यूज़र",
    "page.users.subtitle": "सदस्यों, संपर्क विवरण, भूमिकाओं और मंत्रालय संदेशों को प्रबंधित करें।",
    "page.users.editUser": "यूज़र संपादित करें",
    "page.users.searchPlaceholder": "नाम, ईमेल, फोन, भूमिका, कोड खोजें...",
    "page.users.noUsersFound": "कोई यूज़र नहीं मिला।",
    "page.users.searchFilters": "खोज फ़िल्टर",
    "page.users.profileDetails": "प्रोफ़ाइल विवरण",
    "page.users.userPhoto": "यूज़र फोटो",
    "page.users.uploadPhoto": "फोटो अपलोड करें",
    "page.users.uploading": "अपलोड हो रहा है...",
    "page.users.remove": "हटाएं",
    "page.users.welcomeBroadcast": "स्वागत प्रसारण",
    "page.users.dailyWordBroadcast": "दैनिक वचन प्रसारण",
    "page.users.meetingBroadcast": "बैठक प्रसारण",
    "page.users.message": "संदेश",
    "page.users.channels": "चैनल",
    "page.users.recipients": "प्राप्तकर्ता",
    "page.users.filterRecipients": "प्राप्तकर्ता फ़िल्टर करें...",
    "page.users.selectAll": "सभी चुनें",
    "page.users.loadingRecipients": "प्राप्तकर्ता लोड हो रहे हैं...",
    "page.users.noRecipientsFound": "कोई प्राप्तकर्ता नहीं मिला।",
    "page.users.generating": "पासवर्ड बनाएं",
    "page.users.copyId": "महिमा आईडी कॉपी करें",
    "page.users.joined": "शामिल हुए",
    "page.users.primaryPosition": "प्राथमिक पद",
    "form.displayName": "प्रदर्शित नाम",
    "form.username": "उपयोगकर्ता नाम",
    "form.password": "पासवर्ड",
    "form.role": "भूमिका",
    "form.email": "ईमेल",
    "form.phone": "फोन",
    "form.joinDate": "शामिल होने की तारीख",
    "form.birthday": "जन्मदिन",
    "form.maritalStatus": "वैवाहिक स्थिति",
    "form.sex": "लिंग",
    "form.age": "उम्र",
    "form.aadharNumber": "आधार नंबर",
    "form.homeAddress": "घर का पता",
    "form.currentAddress": "वर्तमान पता",
    "form.emergencyPhone": "आपातकालीन फोन",
    "form.baptismDate": "बपतिस्मा की तारीख",
    "form.baptismPlace": "बपतिस्मा का स्थान",
    "form.mahimaId": "महिमा आईडी",
    "form.primaryPosition": "प्राथमिक पद",
    "form.notAssigned": "नहीं असाइन किया",
    "form.isBaptized": "बपतिस्मा हुआ है",
    "form.isBornAgain": "पुनः जन्मा हुआ है",
    "form.isBeliever": "विश्वासी है",
    "form.isPastor": "पास्टर है",
    "form.payrollEnabled": "पेरोल सक्षम",
    "form.keepCurrentPassword": "खाली छोड़ें वर्तमान रखने के लिए",
    "form.passwordRequired": "आवश्यक",
    "filter.anyRole": "कोई भी भूमिका",
    "filter.anyContact": "कोई भी संपर्क",
    "filter.hasEmail": "ईमेल है",
    "filter.hasPhone": "फोन है",
    "filter.missingEmail": "ईमेल नहीं है",
    "filter.missingPhone": "फोन नहीं है",
    "filter.male": "पुरुष",
    "filter.female": "महिला",
    "filter.joinedFrom": "से शामिल",
    "filter.joinedTo": "तक शामिल",
    "filter.sortBy": "क्रमबद्ध करें",
    "filter.sortDir": "क्रम दिशा",
    "filter.contact": "संपर्क",
    "filter.hasId": "आईडी है",
    "filter.missingId": "आईडी नहीं है",
    "filter.pastor": "पास्टर",
    "filter.baptized": "बपतिस्मा",
    "filter.bornAgain": "पुनर्जन्म",
    "filter.believer": "विश्वासी",
    "filter.single": "अविवाहित",
    "filter.married": "विवाहित",
    "filter.divorced": "तलाकशुदा",
    "filter.widowed": "विधवा/विधुर",
    "page.members.title": "टीम सदस्य",
    "page.members.subtitle": "सदस्यों, भूमिकाओं और टीम लीडर को प्रबंधित करें।",
    "page.members.addMember": "सदस्य जोड़ें",
    "page.members.selectedUser": "चुना गया यूज़र",
    "page.members.chooseUserBelow": "नीचे से यूज़र चुनें",
    "page.members.optionalRole": "वैकल्पिक भूमिका",
    "page.members.markLeader": "लीडर के रूप में चिह्नित करें",
    "page.members.searchUsers": "नाम, ईमेल या उपयोगकर्ता नाम से खोजें",
    "page.members.leader": "लीडर",
    "page.members.joined": "शामिल हुए",
    "page.members.members": "सदस्य",
    "page.members.loadingMembers": "सदस्य लोड हो रहे हैं...",
    "page.members.noMembers": "अभी कोई सदस्य नहीं है। शुरू करने के लिए सदस्य जोड़ें।",
    "page.members.loadingUsers": "यूज़र लोड हो रहे हैं...",
    "page.members.noUsers": "कोई यूज़र नहीं मिला।",
    "page.members.editRole": "भूमिका संपादित करें",
    "page.members.setLeader": "लीडर बनाएं",
    "page.members.unsetLeader": "लीडर हटाएं",
    "page.members.removeMember": "सदस्य हटाएं",
    "page.members.addUser": "यूज़र जोड़ें",
    "page.members.useUser": "यूज़र उपयोग करें",
    "page.members.refreshTeams": "टीम रिफ्रेश करें",
    "page.members.alreadyInTeam": "पहले से टीम में है",
    "page.members.refreshMembers": "सदस्य रिफ्रेश करें",
    "page.members.back": "वापस",
  },
  pa: {
    "layout.language": "ਭਾਸ਼ਾ",
    "layout.openMenu": "ਮੇਨੂ ਖੋਲ੍ਹੋ",
    "layout.closeMenu": "ਮੇਨੂ ਬੰਦ ਕਰੋ",
    "layout.openPastor": "AI ਪਾਸਟਰ ਖੋਲ੍ਹੋ",
    "layout.openChat": "ਚੈਟ ਖੋਲ੍ਹੋ",
    "layout.notifications": "ਸੂਚਨਾਵਾਂ",
    "layout.profile": "ਪ੍ਰੋਫ਼ਾਈਲ ਫੋਟੋ ਅਤੇ ਸਟੇਟਸ",
    "layout.logout": "ਲੌਗ ਆਉਟ",
    "layout.logoutSwitch": "ਲੌਗ ਆਉਟ / ਖਾਤਾ ਬਦਲੋ",
    "layout.collapse": "ਸਮੇਟੋ",
    "layout.expand": "ਫੈਲਾਓ",
    "layout.profileTitle": "ਪ੍ਰੋਫ਼ਾਈਲ",
    "layout.profileSubtitle": "ਆਪਣੀ ਫੋਟੋ ਅਤੇ WhatsApp ਵਰਗਾ ਸਟੇਟਸ ਅਪਡੇਟ ਕਰੋ।",
    "layout.uploadDp": "ਫੋਟੋ ਅਪਲੋਡ ਕਰੋ",
    "layout.photoHint": "ਚੈਟ ਅਤੇ ਐਪ ਹੈਡਰ ਵਿੱਚ ਚੌਰਸ ਫੋਟੋ ਵਧੀਆ ਲੱਗਦੀ ਹੈ।",
    "layout.displayName": "ਦਿਖਾਈ ਦੇਣ ਵਾਲਾ ਨਾਮ",
    "layout.status": "ਸਟੇਟਸ",
    "layout.statusPlaceholder": "ਉਪਲਬਧ, ਪ੍ਰਾਰਥਨਾ ਵਿੱਚ, ਸੇਵਾ ਵਿੱਚ, ਜਾਂ ਛੋਟੀ ਗਵਾਹੀ...",
    "layout.cancel": "ਰੱਦ ਕਰੋ",
    "layout.save": "ਸੇਵ ਕਰੋ",
    "layout.profileUpdated": "ਪ੍ਰੋਫ਼ਾਈਲ ਅਪਡੇਟ ਹੋ ਗਈ।",
    "layout.profileLoadFailed": "ਪ੍ਰੋਫ਼ਾਈਲ ਲੋਡ ਨਹੀਂ ਹੋਈ। ਤੁਸੀਂ ਫਿਰ ਵੀ ਅਪਡੇਟ ਕਰਕੇ ਸੇਵ ਕਰ ਸਕਦੇ ਹੋ।",
    "layout.profileSaveFailed": "ਪ੍ਰੋਫ਼ਾਈਲ ਸੇਵ ਨਹੀਂ ਹੋ ਸਕੀ।",
    "nav.general": "ਆਮ",
    "nav.community": "ਸਮੁਦਾਇ",
    "nav.operations": "ਓਪਰੇਸ਼ਨ",
    "nav.ministry": "ਮਿਨਿਸਟਰੀ",
    "nav.admin": "ਐਡਮਿਨ",
    "nav.home": "ਹੋਮ",
    "nav.aiPastor": "AI ਪਾਸਟਰ",
    "nav.readMe": "ਰੀਡ ਮੀ",
    "nav.appDownloads": "ਐਪ ਡਾਊਨਲੋਡ",
    "nav.sermons": "ਉਪਦੇਸ਼",
    "nav.prayerRequests": "ਪ੍ਰਾਰਥਨਾ ਬੇਨਤੀਆਂ",
    "nav.tasks": "ਕੰਮ",
    "nav.users": "ਯੂਜ਼ਰ",
    "nav.teams": "ਟੀਮਾਂ",
    "nav.roles": "ਭੂਮਿਕਾਵਾਂ",
    "nav.pages": "ਪੇਜ",
    "nav.attendance": "ਹਾਜ਼ਰੀ",
    "nav.payroll": "ਪੇਰੋਲ",
    "nav.costs": "ਖਰਚੇ",
    "nav.marriage": "ਵਿਆਹ",
    "nav.baptism": "ਬਪਤਿਸਮਾ",
    "nav.counselling": "ਕਾਊਂਸਲਿੰਗ",
    "nav.adminDashboard": "ਐਡਮਿਨ ਡੈਸ਼ਬੋਰਡ",
    "nav.liveUsers": "ਲਾਈਵ ਯੂਜ਼ਰ",
    "nav.messageCenter": "ਸੁਨੇਹਾ ਕੇਂਦਰ",
    "nav.languages": "ਭਾਸ਼ਾਵਾਂ",
    "nav.emailClient": "ਈਮੇਲ ਕਲਾਇੰਟ",
    "nav.googleDrive": "ਗੂਗਲ ਡਰਾਈਵ",
    "nav.serverFiles": "ਸਰਵਰ ਫਾਈਲਾਂ",
    "common.addUser": "ਯੂਜ਼ਰ ਜੋੜੋ",
    "common.refresh": "ਰੀਫ੍ਰੈਸ਼",
    "common.search": "ਖੋਜੋ",
    "common.cancel": "ਰੱਦ ਕਰੋ",
    "common.save": "ਸੇਵ ਕਰੋ",
    "common.delete": "ਹਟਾਓ",
    "common.edit": "ਸੋਧੋ",
    "common.download": "ਡਾਊਨਲੋਡ",
    "common.upload": "ਅਪਲੋਡ",
    "common.send": "ਭੇਜੋ",
    "common.close": "ਬੰਦ ਕਰੋ",
    "common.loading": "ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ",
    "common.retry": "ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ",
    "common.noData": "ਕੋਈ ਡਾਟਾ ਨਹੀਂ",
    "common.actions": "ਕਾਰਵਾਈਆਂ",
    "common.status": "ਸਥਿਤੀ",
    "common.role": "ਭੂਮਿਕਾ",
    "common.name": "ਨਾਮ",
    "common.email": "ਈਮੇਲ",
    "common.phone": "ਫੋਨ",
    "common.date": "ਤਾਰੀਖ",
    "common.prev": "ਪਿਛਲਾ",
    "common.next": "ਅਗਲਾ",
    "common.clear": "ਸਾਫ਼ ਕਰੋ",
    "common.done": "ਹੋ ਗਿਆ",
    "common.reset": "ਰੀਸੈੱਟ",
    "common.add": "ਜੋੜੋ",
    "common.remove": "ਹਟਾਓ",
    "common.back": "ਵਾਪਸ",
    "common.showing": "ਦਿਖਾ ਰਹੇ ਹਾਂ",
    "common.of": "ਵਿੱਚੋਂ",
    "common.select": "ਚੁਣੋ",
    "common.any": "ਕੋਈ ਵੀ",
    "common.yes": "ਹਾਂ",
    "common.no": "ਨਹੀਂ",
    "common.ascending": "ਚੜ੍ਹਦਾ",
    "common.descending": "ਉੱਤਰਦਾ",
    "common.relevance": "ਸੰਬੰਧਤਾ",
    "common.joinDate": "ਸ਼ਾਮਲ ਤਾਰੀਖ",
    "common.noDataFound": "ਕੋਈ ਡਾਟਾ ਨਹੀਂ ਮਿਲਿਆ।",
    "page.users.title": "ਯੂਜ਼ਰ",
    "page.users.subtitle": "ਮੈਂਬਰਾਂ, ਸੰਪਰਕ ਵੇਰਵਿਆਂ, ਭੂਮਿਕਾਵਾਂ ਅਤੇ ਮਿਨਿਸਟ੍ਰੀ ਸੁਨੇਹਿਆਂ ਦਾ ਪ੍ਰਬੰਧਨ ਕਰੋ।",
    "page.users.editUser": "ਯੂਜ਼ਰ ਸੋਧੋ",
    "page.users.searchPlaceholder": "ਨਾਮ, ਈਮੇਲ, ਫੋਨ, ਭੂਮਿਕਾ, ਕੋਡ ਖੋਜੋ...",
    "page.users.noUsersFound": "ਕੋਈ ਯੂਜ਼ਰ ਨਹੀਂ ਮਿਲਿਆ।",
    "page.users.searchFilters": "ਖੋਜ ਫਿਲਟਰ",
    "page.users.profileDetails": "ਪ੍ਰੋਫ਼ਾਈਲ ਵੇਰਵੇ",
    "page.users.userPhoto": "ਯੂਜ਼ਰ ਫੋਟੋ",
    "page.users.uploadPhoto": "ਫੋਟੋ ਅਪਲੋਡ ਕਰੋ",
    "page.users.uploading": "ਅਪਲੋਡ ਹੋ ਰਿਹਾ ਹੈ...",
    "page.users.remove": "ਹਟਾਓ",
    "page.users.welcomeBroadcast": "ਸੁਆਗਤ ਪ੍ਰਸਾਰਣ",
    "page.users.dailyWordBroadcast": "ਰੋਜ਼ਾਨਾ ਵਚਨ ਪ੍ਰਸਾਰਣ",
    "page.users.meetingBroadcast": "ਮੀਟਿੰਗ ਪ੍ਰਸਾਰਣ",
    "page.users.message": "ਸੁਨੇਹਾ",
    "page.users.channels": "ਚੈਨਲ",
    "page.users.recipients": "ਪ੍ਰਾਪਤਕਰਤਾ",
    "page.users.filterRecipients": "ਪ੍ਰਾਪਤਕਰਤਾ ਫਿਲਟਰ ਕਰੋ...",
    "page.users.selectAll": "ਸਭ ਚੁਣੋ",
    "page.users.loadingRecipients": "ਪ੍ਰਾਪਤਕਰਤਾ ਲੋਡ ਹੋ ਰਹੇ ਹਨ...",
    "page.users.noRecipientsFound": "ਕੋਈ ਪ੍ਰਾਪਤਕਰਤਾ ਨਹੀਂ ਮਿਲਿਆ।",
    "page.users.generating": "ਪਾਸਵਰਡ ਬਣਾਓ",
    "page.users.copyId": "ਮਹਿਮਾ ਆਈਡੀ ਕਾਪੀ ਕਰੋ",
    "page.users.joined": "ਸ਼ਾਮਲ ਹੋਇਆ",
    "page.users.primaryPosition": "ਮੁੱਖ ਅਹੁਦਾ",
    "form.displayName": "ਦਿਖਾਈ ਦੇਣ ਵਾਲਾ ਨਾਮ",
    "form.username": "ਉਪਯੋਗਕਰਤਾ ਨਾਮ",
    "form.password": "ਪਾਸਵਰਡ",
    "form.role": "ਭੂਮਿਕਾ",
    "form.email": "ਈਮੇਲ",
    "form.phone": "ਫੋਨ",
    "form.joinDate": "ਸ਼ਾਮਲ ਹੋਣ ਦੀ ਤਾਰੀਖ",
    "form.birthday": "ਜਨਮਦਿਨ",
    "form.maritalStatus": "ਵਿਆਹੁਤਾ ਸਥਿਤੀ",
    "form.sex": "ਲਿੰਗ",
    "form.age": "ਉਮਰ",
    "form.aadharNumber": "ਆਧਾਰ ਨੰਬਰ",
    "form.homeAddress": "ਘਰ ਦਾ ਪਤਾ",
    "form.currentAddress": "ਮੌਜੂਦਾ ਪਤਾ",
    "form.emergencyPhone": "ਐਮਰਜੈਂਸੀ ਫੋਨ",
    "form.baptismDate": "ਬਪਤਿਸਮੇ ਦੀ ਤਾਰੀਖ",
    "form.baptismPlace": "ਬਪਤਿਸਮੇ ਦੀ ਜਗ੍ਹਾ",
    "form.mahimaId": "ਮਹਿਮਾ ਆਈਡੀ",
    "form.primaryPosition": "ਮੁੱਖ ਅਹੁਦਾ",
    "form.notAssigned": "ਨਿਰਧਾਰਿਤ ਨਹੀਂ",
    "form.isBaptized": "ਬਪਤਿਸਮਾ ਲਿਆ ਹੈ",
    "form.isBornAgain": "ਦੁਬਾਰਾ ਜੰਮਿਆ ਹੈ",
    "form.isBeliever": "ਵਿਸ਼ਵਾਸੀ ਹੈ",
    "form.isPastor": "ਪਾਸਟਰ ਹੈ",
    "form.payrollEnabled": "ਪੇਰੋਲ ਸਮਰੱਥ",
    "form.keepCurrentPassword": "ਖਾਲੀ ਛੱਡੋ ਮੌਜੂਦਾ ਰੱਖਣ ਲਈ",
    "form.passwordRequired": "ਲੋੜੀਂਦਾ",
    "filter.anyRole": "ਕੋਈ ਵੀ ਭੂਮਿਕਾ",
    "filter.anyContact": "ਕੋਈ ਵੀ ਸੰਪਰਕ",
    "filter.hasEmail": "ਈਮੇਲ ਹੈ",
    "filter.hasPhone": "ਫੋਨ ਹੈ",
    "filter.missingEmail": "ਈਮੇਲ ਨਹੀਂ",
    "filter.missingPhone": "ਫੋਨ ਨਹੀਂ",
    "filter.male": "ਪੁਰਸ਼",
    "filter.female": "ਔਰਤ",
    "filter.joinedFrom": "ਤੋਂ ਸ਼ਾਮਲ",
    "filter.joinedTo": "ਤੱਕ ਸ਼ਾਮਲ",
    "filter.sortBy": "ਕ੍ਰਮਬੱਧ ਕਰੋ",
    "filter.sortDir": "ਕ੍ਰਮ ਦਿਸ਼ਾ",
    "filter.contact": "ਸੰਪਰਕ",
    "filter.hasId": "ਆਈਡੀ ਹੈ",
    "filter.missingId": "ਆਈਡੀ ਨਹੀਂ",
    "filter.pastor": "ਪਾਸਟਰ",
    "filter.baptized": "ਬਪਤਿਸਮਾ",
    "filter.bornAgain": "ਦੁਬਾਰਾ ਜੰਮਿਆ",
    "filter.believer": "ਵਿਸ਼ਵਾਸੀ",
    "filter.single": "ਅਣਵਿਆਹਿਆ",
    "filter.married": "ਵਿਆਹਿਆ",
    "filter.divorced": "ਤਲਾਕਸ਼ੁਦਾ",
    "filter.widowed": "ਵਿਧਵਾ/ਵਿਧੁਰ",
    "page.members.title": "ਟੀਮ ਮੈਂਬਰ",
    "page.members.subtitle": "ਮੈਂਬਰਾਂ, ਭੂਮਿਕਾਵਾਂ ਅਤੇ ਟੀਮ ਲੀਡਰ ਦਾ ਪ੍ਰਬੰਧਨ ਕਰੋ।",
    "page.members.addMember": "ਮੈਂਬਰ ਜੋੜੋ",
    "page.members.selectedUser": "ਚੁਣਿਆ ਯੂਜ਼ਰ",
    "page.members.chooseUserBelow": "ਹੇਠੋਂ ਯੂਜ਼ਰ ਚੁਣੋ",
    "page.members.optionalRole": "ਵਿਕਲਪਿਕ ਭੂਮਿਕਾ",
    "page.members.markLeader": "ਲੀਡਰ ਵਜੋਂ ਦਰਸਾਓ",
    "page.members.searchUsers": "ਨਾਮ, ਈਮੇਲ ਜਾਂ ਉਪਯੋਗਕਰਤਾ ਨਾਮ ਨਾਲ ਖੋਜੋ",
    "page.members.leader": "ਲੀਡਰ",
    "page.members.joined": "ਸ਼ਾਮਲ ਹੋਇਆ",
    "page.members.members": "ਮੈਂਬਰ",
    "page.members.loadingMembers": "ਮੈਂਬਰ ਲੋਡ ਹੋ ਰਹੇ ਹਨ...",
    "page.members.noMembers": "ਅਜੇ ਕੋਈ ਮੈਂਬਰ ਨਹੀਂ। ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਮੈਂਬਰ ਜੋੜੋ।",
    "page.members.loadingUsers": "ਯੂਜ਼ਰ ਲੋਡ ਹੋ ਰਹੇ ਹਨ...",
    "page.members.noUsers": "ਕੋਈ ਯੂਜ਼ਰ ਨਹੀਂ ਮਿਲਿਆ।",
    "page.members.editRole": "ਭੂਮਿਕਾ ਸੋਧੋ",
    "page.members.setLeader": "ਲੀਡਰ ਬਣਾਓ",
    "page.members.unsetLeader": "ਲੀਡਰ ਹਟਾਓ",
    "page.members.removeMember": "ਮੈਂਬਰ ਹਟਾਓ",
    "page.members.addUser": "ਯੂਜ਼ਰ ਜੋੜੋ",
    "page.members.useUser": "ਯੂਜ਼ਰ ਵਰਤੋ",
    "page.members.refreshTeams": "ਟੀਮਾਂ ਰਿਫ੍ਰੈਸ਼ ਕਰੋ",
    "page.members.alreadyInTeam": "ਪਹਿਲਾਂ ਤੋਂ ਟੀਮ ਵਿੱਚ ਹੈ",
    "page.members.refreshMembers": "ਮੈਂਬਰ ਰਿਫ੍ਰੈਸ਼ ਕਰੋ",
    "page.members.back": "ਵਾਪਸ",
  },
  or: {
    "layout.language": "ଭାଷା",
    "layout.openMenu": "ମେନୁ ଖୋଲନ୍ତୁ",
    "layout.closeMenu": "ମେନୁ ବନ୍ଦ କରନ୍ତୁ",
    "layout.openPastor": "AI ପାଷ୍ଟର ଖୋଲନ୍ତୁ",
    "layout.openChat": "ଚାଟ୍ ଖୋଲନ୍ତୁ",
    "layout.notifications": "ସୂଚନା",
    "layout.profile": "ପ୍ରୋଫାଇଲ୍ ଫଟୋ ଓ ସ୍ଥିତି",
    "layout.logout": "ଲଗ୍ ଆଉଟ୍",
    "layout.logoutSwitch": "ଲଗ୍ ଆଉଟ୍ / ଖାତା ବଦଳାନ୍ତୁ",
    "layout.collapse": "ସଙ୍କୋଚନ",
    "layout.expand": "ବିସ୍ତାର",
    "layout.profileTitle": "ପ୍ରୋଫାଇଲ୍",
    "layout.profileSubtitle": "ଆପଣଙ୍କ ଫଟୋ ଓ WhatsApp ଭଳି ସ୍ଥିତି ଅପଡେଟ୍ କରନ୍ତୁ।",
    "layout.uploadDp": "ଫଟୋ ଅପଲୋଡ୍",
    "layout.photoHint": "ଚାଟ୍ ଓ ଆପ୍ ହେଡରରେ ଚତୁର୍ଭୁଜ ଫଟୋ ଭଲ ଲାଗେ।",
    "layout.displayName": "ଦେଖାଯାଉଥିବା ନାମ",
    "layout.status": "ସ୍ଥିତି",
    "layout.statusPlaceholder": "ଉପଲବ୍ଧ, ପ୍ରାର୍ଥନାରେ, ସେବାରେ, କିମ୍ବା ଛୋଟ ସାକ୍ଷ୍ୟ...",
    "layout.cancel": "ବାତିଲ୍",
    "layout.save": "ସେଭ୍",
    "layout.profileUpdated": "ପ୍ରୋଫାଇଲ୍ ଅପଡେଟ୍ ହେଲା।",
    "layout.profileLoadFailed": "ପ୍ରୋଫାଇଲ୍ ଲୋଡ୍ ହେଲା ନାହିଁ। ଆପଣ ତଥାପି ଅପଡେଟ୍ କରି ସେଭ୍ କରିପାରିବେ।",
    "layout.profileSaveFailed": "ପ୍ରୋଫାଇଲ୍ ସେଭ୍ ହେଲା ନାହିଁ।",
    "nav.general": "ସାଧାରଣ",
    "nav.community": "ସମୁଦାୟ",
    "nav.operations": "କାର୍ଯ୍ୟ",
    "nav.ministry": "ମିନିଷ୍ଟ୍ରି",
    "nav.admin": "ଆଡମିନ୍",
    "nav.home": "ହୋମ୍",
    "nav.aiPastor": "AI ପାଷ୍ଟର",
    "nav.readMe": "ରିଡ୍ ମି",
    "nav.appDownloads": "ଆପ୍ ଡାଉନଲୋଡ୍",
    "nav.sermons": "ପ୍ରବଚନ",
    "nav.prayerRequests": "ପ୍ରାର୍ଥନା ଅନୁରୋଧ",
    "nav.tasks": "କାମ",
    "nav.users": "ୟୁଜର୍",
    "nav.teams": "ଟିମ୍",
    "nav.roles": "ଭୂମିକା",
    "nav.pages": "ପେଜ୍",
    "nav.attendance": "ଉପସ୍ଥିତି",
    "nav.payroll": "ପେରୋଲ୍",
    "nav.costs": "ଖର୍ଚ୍ଚ",
    "nav.marriage": "ବିବାହ",
    "nav.baptism": "ବପ୍ତିସ୍ମା",
    "nav.counselling": "ପରାମର୍ଶ",
    "nav.adminDashboard": "ଆଡମିନ୍ ଡ୍ୟାଶବୋର୍ଡ",
    "nav.liveUsers": "ଲାଇଭ୍ ୟୁଜର୍",
    "nav.messageCenter": "ମେସେଜ୍ ସେଣ୍ଟର୍",
    "nav.languages": "ଭାଷା",
    "nav.emailClient": "ଇମେଲ୍ କ୍ଲାୟେଣ୍ଟ",
    "nav.googleDrive": "ଗୁଗୁଲ୍ ଡ୍ରାଇଭ୍",
    "nav.serverFiles": "ସର୍ଭର ଫାଇଲ୍",
    "common.addUser": "ୟୁଜର୍ ଯୋଡନ୍ତୁ",
    "common.refresh": "ରିଫ୍ରେଶ୍",
    "common.search": "ଖୋଜନ୍ତୁ",
    "common.cancel": "ବାତିଲ୍",
    "common.save": "ସେଭ୍",
    "common.delete": "ଡିଲିଟ୍",
    "common.edit": "ସଂପାଦନ",
    "common.download": "ଡାଉନଲୋଡ୍",
    "common.upload": "ଅପଲୋଡ୍",
    "common.send": "ପଠାନ୍ତୁ",
    "common.close": "ବନ୍ଦ",
    "common.loading": "ଲୋଡ୍ ହେଉଛି",
    "common.retry": "ପୁଣି ଚେଷ୍ଟା",
    "common.noData": "ଡାଟା ନାହିଁ",
    "common.actions": "କାର୍ଯ୍ୟ",
    "common.status": "ସ୍ଥିତି",
    "common.role": "ଭୂମିକା",
    "common.name": "ନାମ",
    "common.email": "ଇମେଲ୍",
    "common.phone": "ଫୋନ୍",
    "common.date": "ତାରିଖ",
    "common.prev": "ପୂର୍ବ",
    "common.next": "ପରବର୍ତ୍ତୀ",
    "common.clear": "ସଫା",
    "common.done": "ସମ୍ପନ୍ନ",
    "common.reset": "ରିସେଟ",
    "common.add": "ଯୋଡ଼ନ୍ତୁ",
    "common.remove": "ହଟାନ୍ତୁ",
    "common.back": "ପଛକୁ",
    "common.showing": "ଦେଖାଯାଉଛି",
    "common.of": "ର",
    "common.select": "ବାଛନ୍ତୁ",
    "common.any": "ଯେ କୌଣସି",
    "common.yes": "ହଁ",
    "common.no": "ନା",
    "common.ascending": "ଉର୍ଦ୍ଧ୍ୱ",
    "common.descending": "ଅବତ",
    "common.relevance": "ପ୍ରାସଙ୍ଗିକତା",
    "common.joinDate": "ଯୋଗ ତାରିଖ",
    "common.noDataFound": "ଡାଟା ମିଳିଲା ନାହିଁ।",
    "page.users.title": "ୟୁଜର",
    "page.users.subtitle": "ସଦସ୍ୟ, ଯୋଗାଯୋଗ ବିବରଣ, ଭୂମିକା ଏବଂ ମନ୍ତ୍ରଣ ସନ୍ଦେଶ ପ୍ରବନ୍ଧ କରନ୍ତୁ।",
    "page.users.editUser": "ୟୁଜର ସଂପାଦନ",
    "page.users.searchPlaceholder": "ନାମ, ଇମେଲ, ଫୋନ, ଭୂମିକା, କୋଡ ଖୋଜନ୍ତୁ...",
    "page.users.noUsersFound": "କୌଣସି ୟୁଜ ମିଳିଲା ନାହିଁ।",
    "page.users.searchFilters": "ଖୋଜ ଫିଲ୍ଟ",
    "page.users.profileDetails": "ପ୍ରୋଫାଇଲ ବିବ",
    "page.users.userPhoto": "ୟୁଜ ଫୋ",
    "page.users.uploadPhoto": "ଫୋ ଅପ",
    "page.users.uploading": "ଅ ହ...",
    "page.users.remove": "ହଟ",
    "page.users.welcomeBroadcast": "ସ୍ୱ ସ",
    "page.users.dailyWordBroadcast": "ଦୈ ବ ସ",
    "page.users.meetingBroadcast": "ବ ସ",
    "page.users.message": "ସ",
    "page.users.channels": "ଚ",
    "page.users.recipients": "ପ",
    "page.users.filterRecipients": "ପ ଫ...",
    "page.users.selectAll": "ସ ବ",
    "page.users.loadingRecipients": "ପ ଲ...",
    "page.users.noRecipientsFound": "କ ପ ମ",
    "page.users.generating": "ପ ବ",
    "page.users.copyId": "ମ ଆ କ",
    "page.users.joined": "ଯ ଦ",
    "page.users.primaryPosition": "ମ ପ",
    "form.displayName": "ଦ ନ",
    "form.username": "ୟ ନ",
    "form.password": "ପ",
    "form.role": "ଭ",
    "form.email": "ଇ",
    "form.phone": "ଫ",
    "form.joinDate": "ଯ ତ",
    "form.birthday": "ଜ",
    "form.maritalStatus": "ବ ସ",
    "form.sex": "ଲ",
    "form.age": "ବ",
    "form.aadharNumber": "ଆ ନ",
    "form.homeAddress": "ଘ ଠ",
    "form.currentAddress": "ବ ଠ",
    "form.emergencyPhone": "ଜ ଫ",
    "form.baptismDate": "ବ ତ",
    "form.baptismPlace": "ବ ସ",
    "form.mahimaId": "ମ ଆ",
    "form.primaryPosition": "ମ ପ",
    "form.notAssigned": "ନ",
    "form.isBaptized": "ବ ହ",
    "form.isBornAgain": "ପ ହ",
    "form.isBeliever": "ବ ଅ",
    "form.isPastor": "ପ ଅ",
    "form.payrollEnabled": "ପ ସ",
    "form.keepCurrentPassword": "ଖ ର",
    "form.passwordRequired": "ଆ",
    "filter.anyRole": "ଯ ଭ",
    "filter.anyContact": "ଯ ଯ",
    "filter.hasEmail": "ଇ ଅ",
    "filter.hasPhone": "ଫ ଅ",
    "filter.missingEmail": "ଇ ନ",
    "filter.missingPhone": "ଫ ନ",
    "filter.male": "ପ",
    "filter.female": "ମ",
    "filter.joinedFrom": "ଦ ଯ",
    "filter.joinedTo": "ସ ଯ",
    "filter.sortBy": "କ କ",
    "filter.sortDir": "କ ଦ",
    "filter.contact": "ଯ",
    "filter.hasId": "ଆ ଅ",
    "filter.missingId": "ଆ ନ",
    "filter.pastor": "ପ",
    "filter.baptized": "ବ",
    "filter.bornAgain": "ପ",
    "filter.believer": "ବ",
    "filter.single": "ଅ",
    "filter.married": "ବ",
    "filter.divorced": "ତ",
    "filter.widowed": "ବ",
    "page.members.title": "ଟ ସ",
    "page.members.subtitle": "ସ, ଭ ଏ ଟ ନ ପ କ।",
    "page.members.addMember": "ସ ଯ",
    "page.members.selectedUser": "ବ ୟ",
    "page.members.chooseUserBelow": "ତ ୟ ବ",
    "page.members.optionalRole": "ଐ ଭ",
    "page.members.markLeader": "ନ ର ଚ",
    "page.members.searchUsers": "ନ ଇ ବ ୟ ଖ",
    "page.members.leader": "ନ",
    "page.members.joined": "ଯ",
    "page.members.members": "ସ",
    "page.members.loadingMembers": "ସ ଲ...",
    "page.members.noMembers": "ଏ କ ସ ନ। ସ ଯ।",
    "page.members.loadingUsers": "ୟ ଲ...",
    "page.members.noUsers": "କ ୟ ମ।",
    "page.members.editRole": "ଭ ସ",
    "page.members.setLeader": "ନ ବ",
    "page.members.unsetLeader": "ନ ହ",
    "page.members.removeMember": "ସ ହ",
    "page.members.addUser": "ୟ ଯ",
    "page.members.useUser": "ୟ ପ",
    "page.members.refreshTeams": "ଟ ତ",
    "page.members.alreadyInTeam": "ପ ଟ ଅ",
    "page.members.refreshMembers": "ସ ତ",
    "page.members.back": "ପ",
  },
  ta: {
    "layout.language": "மொழி",
    "layout.openMenu": "மெனுவை திற",
    "layout.closeMenu": "மெனுவை மூடு",
    "layout.openPastor": "AI பாஸ்டரை திற",
    "layout.openChat": "சாட்டை திற",
    "layout.notifications": "அறிவிப்புகள்",
    "layout.profile": "ப்ரொஃபைல் படம் மற்றும் நிலை",
    "layout.logout": "வெளியேறு",
    "layout.logoutSwitch": "வெளியேறு / கணக்கு மாற்று",
    "layout.collapse": "சுருக்கு",
    "layout.expand": "விரிவாக்கு",
    "layout.profileTitle": "ப்ரொஃபைல்",
    "layout.profileSubtitle": "உங்கள் படம் மற்றும் WhatsApp போன்ற நிலையை புதுப்பிக்கவும்.",
    "layout.uploadDp": "படம் பதிவேற்று",
    "layout.photoHint": "சதுர படம் சாட் மற்றும் ஆப் ஹெடரில் நன்றாக தெரியும்.",
    "layout.displayName": "காட்சி பெயர்",
    "layout.status": "நிலை",
    "layout.statusPlaceholder": "கிடைக்கிறது, ஜெபத்தில், சேவையில், அல்லது சிறிய சாட்சி...",
    "layout.cancel": "ரத்து",
    "layout.save": "சேமி",
    "layout.profileUpdated": "ப்ரொஃபைல் புதுப்பிக்கப்பட்டது.",
    "layout.profileLoadFailed": "ப்ரொஃபைல் ஏற்றப்படவில்லை. இருந்தாலும் புதுப்பித்து சேமிக்கலாம்.",
    "layout.profileSaveFailed": "ப்ரொஃபைல் சேமிக்க முடியவில்லை.",
    "nav.general": "பொது",
    "nav.community": "சமூகம்",
    "nav.operations": "செயல்பாடுகள்",
    "nav.ministry": "ஊழியம்",
    "nav.admin": "அட்மின்",
    "nav.home": "முகப்பு",
    "nav.aiPastor": "AI பாஸ்டர்",
    "nav.readMe": "ரீட்மீ",
    "nav.appDownloads": "ஆப் பதிவிறக்கம்",
    "nav.sermons": "பிரசங்கங்கள்",
    "nav.prayerRequests": "ஜெப வேண்டுகோள்கள்",
    "nav.tasks": "பணிகள்",
    "nav.users": "பயனர்கள்",
    "nav.teams": "அணிகள்",
    "nav.roles": "பங்குகள்",
    "nav.pages": "பக்கங்கள்",
    "nav.attendance": "வருகை",
    "nav.payroll": "பேரோல்",
    "nav.costs": "செலவுகள்",
    "nav.marriage": "திருமணம்",
    "nav.baptism": "ஞானஸ்நானம்",
    "nav.counselling": "ஆலோசனை",
    "nav.adminDashboard": "அட்மின் டாஷ்போர்டு",
    "nav.liveUsers": "நேரடி பயனர்கள்",
    "nav.messageCenter": "செய்தி மையம்",
    "nav.languages": "மொழிகள்",
    "nav.emailClient": "மின்னஞ்சல் கிளையன்ட்",
    "nav.googleDrive": "கூகுள் டிரைவ்",
    "nav.serverFiles": "சர்வர் கோப்புகள்",
    "common.addUser": "பயனர் சேர்",
    "common.refresh": "புதுப்பி",
    "common.search": "தேடு",
    "common.cancel": "ரத்து",
    "common.save": "சேமி",
    "common.delete": "நீக்கு",
    "common.edit": "திருத்து",
    "common.download": "பதிவிறக்கு",
    "common.upload": "பதிவேற்று",
    "common.send": "அனுப்பு",
    "common.close": "மூடு",
    "common.loading": "ஏற்றுகிறது",
    "common.retry": "மீண்டும் முயற்சி",
    "common.noData": "தரவு இல்லை",
    "common.actions": "செயல்கள்",
    "common.status": "நிலை",
    "common.role": "பங்கு",
    "common.name": "பெயர்",
    "common.email": "மின்னஞ்சல்",
    "common.phone": "தொலைபேசி",
    "common.date": "தேதி",
    "common.prev": "முந்தைய",
    "common.next": "அடுத்து",
    "common.clear": "அழி",
    "common.done": "முடிந்தது",
    "common.reset": "மீட்டமை",
    "common.add": "சேர்",
    "common.remove": "நீக்கு",
    "common.back": "பின்",
    "common.showing": "காட்டுகிறது",
    "common.of": "இல்",
    "common.select": "தேர்ந்தெடு",
    "common.any": "எதுவும்",
    "common.yes": "ஆம்",
    "common.no": "இல்லை",
    "common.ascending": "ஏறு வரிசை",
    "common.descending": "இறங்கு வரிசை",
    "common.relevance": "தொடர்பு",
    "common.joinDate": "சேர்ந்த தேதி",
    "common.noDataFound": "தரவு கிடைக்கவில்லை.",
    "page.users.title": "பயனர்கள்",
    "page.users.subtitle": "உறுப்பினர்கள், தொடர்பு விவரங்கள், பாத்திரங்கள் மற்றும் ஊழியர் செய்திகளை நிர்வகிக்கவும்.",
    "page.users.editUser": "பயனரை திருத்து",
    "page.users.searchPlaceholder": "பெயர், மின்னஞ்சல், தொலைபேசி, பாத்திரம், குறியீடு தேடு...",
    "page.users.noUsersFound": "பயனர்கள் கிடைக்கவில்லை.",
    "page.users.searchFilters": "தேடல் வடிப்பான்கள்",
    "page.users.profileDetails": "சுயவிவர விவரங்கள்",
    "page.users.userPhoto": "பயனர் புகைப்படம்",
    "page.users.uploadPhoto": "புகைப்படம் பதிவேற்று",
    "page.users.uploading": "பதிவேற்றுகிறது...",
    "page.users.remove": "நீக்கு",
    "page.users.welcomeBroadcast": "வரவேற்பு செய்தி",
    "page.users.dailyWordBroadcast": "தினசரி வார்த்தை",
    "page.users.meetingBroadcast": "கூட்ட செய்தி",
    "page.users.message": "செய்தி",
    "page.users.channels": "சேனல்கள்",
    "page.users.recipients": "பெறுநர்கள்",
    "page.users.filterRecipients": "பெறுநர்களை வடிகட்டு...",
    "page.users.selectAll": "அனைத்தும் தேர்ந்தெடு",
    "page.users.loadingRecipients": "பெறுநர்கள் ஏற்றுகிறது...",
    "page.users.noRecipientsFound": "பெறுநர்கள் கிடைக்கவில்லை.",
    "page.users.generating": "உருவாக்குகிறது...",
    "page.users.copyId": "மகிமா ஐடி நகலெடு",
    "page.users.joined": "சேர்ந்தது",
    "page.users.primaryPosition": "முதன்மை பதவி",
    "form.displayName": "காட்சி பெயர்",
    "form.username": "பயனர்பெயர்",
    "form.password": "கடவுச்சொல்",
    "form.role": "பாத்திரம்",
    "form.email": "மின்னஞ்சல்",
    "form.phone": "தொலைபேசி",
    "form.joinDate": "சேர்ந்த தேதி",
    "form.birthday": "பிறந்தநாள்",
    "form.maritalStatus": "திருமண நிலை",
    "form.sex": "பாலினம்",
    "form.age": "வயது",
    "form.aadharNumber": "ஆதார் எண்",
    "form.homeAddress": "வீட்டு முகவரி",
    "form.currentAddress": "தற்போதைய முகவரி",
    "form.emergencyPhone": "அவசர தொலைபேசி",
    "form.baptismDate": "ஞானஸ்நானம் தேதி",
    "form.baptismPlace": "ஞானஸ்நானம் இடம்",
    "form.mahimaId": "மகிமா ஐடி",
    "form.primaryPosition": "முதன்மை பதவி",
    "form.notAssigned": "நியமிக்கப்படவில்லை",
    "form.isBaptized": "ஞானஸ்நானம் பெற்றவர்",
    "form.isBornAgain": "மறுபடியும் பிறந்தவர்",
    "form.isBeliever": "விசுவாசி",
    "form.isPastor": "போதகர்",
    "form.payrollEnabled": "சம்பள பட்டியல்",
    "form.keepCurrentPassword": "தற்போதைய கடவுச்சொல் வை",
    "form.passwordRequired": "கடவுச்சொல் தேவை",
    "filter.anyRole": "எந்த பாத்திரமும்",
    "filter.anyContact": "எந்த தொடர்பும்",
    "filter.hasEmail": "மின்னஞ்சல் உள்ளது",
    "filter.hasPhone": "தொலைபேசி உள்ளது",
    "filter.missingEmail": "மின்னஞ்சல் இல்லை",
    "filter.missingPhone": "தொலைபேசி இல்லை",
    "filter.male": "ஆண்",
    "filter.female": "பெண்",
    "filter.joinedFrom": "சேர்ந்தது முதல்",
    "filter.joinedTo": "சேர்ந்தது வரை",
    "filter.sortBy": "வரிசைப்படுத்து",
    "filter.sortDir": "திசை",
    "filter.contact": "தொடர்பு",
    "filter.hasId": "ஆதார் உள்ளது",
    "filter.missingId": "ஆதார் இல்லை",
    "filter.pastor": "போதகர்",
    "filter.baptized": "ஞானஸ்நானம்",
    "filter.bornAgain": "மறுபடியும் பிறந்தவர்",
    "filter.believer": "விசுவாசி",
    "filter.single": "திருமணமாகாதவர்",
    "filter.married": "திருமணமானவர்",
    "filter.divorced": "விவாகரத்து",
    "filter.widowed": "விதவை",
    "page.members.title": "குழு உறுப்பினர்கள்",
    "page.members.subtitle": "உறுப்பினர்கள், பாத்திரங்கள் மற்றும் குழுத் தலைவரை நிர்வகிக்கவும்.",
    "page.members.addMember": "உறுப்பினர் சேர்",
    "page.members.selectedUser": "தேர்ந்த பயனர்",
    "page.members.chooseUserBelow": "கீழே பயனரை தேர்ந்தெடு",
    "page.members.optionalRole": "விருப்ப பாத்திரம்",
    "page.members.markLeader": "தலைவராக குறி",
    "page.members.searchUsers": "பெயர், மின்னஞ்சல் தேடு",
    "page.members.leader": "தலைவர்",
    "page.members.joined": "சேர்ந்தது",
    "page.members.members": "உறுப்பினர்கள்",
    "page.members.loadingMembers": "உறுப்பினர்கள் ஏற்றுகிறது...",
    "page.members.noMembers": "உறுப்பினர்கள் இல்லை. ஒருவரை சேர்க்கவும்.",
    "page.members.loadingUsers": "பயனர்கள் ஏற்றுகிறது...",
    "page.members.noUsers": "பயனர்கள் கிடைக்கவில்லை.",
    "page.members.editRole": "பாத்திரம் திருத்து",
    "page.members.setLeader": "தலைவராக்கு",
    "page.members.unsetLeader": "தலைவர் அல்ல",
    "page.members.removeMember": "உறுப்பினர் நீக்கு",
    "page.members.addUser": "பயனர் சேர்",
    "page.members.useUser": "பயனர் பயன்படுத்து",
    "page.members.refreshTeams": "குழுக்கள் புதுப்பி",
    "page.members.alreadyInTeam": "ஏற்கனவே குழுவில் உள்ளார்",
    "page.members.refreshMembers": "உறுப்பினர்கள் புதுப்பி",
    "page.members.back": "பின்",
  },
  mr: {
    "layout.language": "भाषा",
    "layout.openMenu": "मेनू उघडा",
    "layout.closeMenu": "मेनू बंद करा",
    "layout.openPastor": "AI पास्टर उघडा",
    "layout.openChat": "चॅट उघडा",
    "layout.notifications": "सूचना",
    "layout.profile": "प्रोफाइल फोटो आणि स्टेटस",
    "layout.logout": "लॉग आउट",
    "layout.logoutSwitch": "लॉग आउट / खाते बदला",
    "layout.collapse": "संकुचित करा",
    "layout.expand": "विस्तृत करा",
    "layout.profileTitle": "प्रोफाइल",
    "layout.profileSubtitle": "तुमचा फोटो आणि WhatsApp सारखा स्टेटस अपडेट करा.",
    "layout.uploadDp": "फोटो अपलोड करा",
    "layout.photoHint": "चॅट आणि अॅप हेडरमध्ये चौकोनी फोटो उत्तम दिसतो.",
    "layout.displayName": "दर्शविले जाणारे नाव",
    "layout.status": "स्टेटस",
    "layout.statusPlaceholder": "उपलब्ध, प्रार्थनेत, सेवेत, किंवा छोटी साक्ष...",
    "layout.cancel": "रद्द करा",
    "layout.save": "सेव्ह करा",
    "layout.profileUpdated": "प्रोफाइल अपडेट झाले.",
    "layout.profileLoadFailed": "प्रोफाइल लोड झाले नाही. तरीही तुम्ही अपडेट करून सेव्ह करू शकता.",
    "layout.profileSaveFailed": "प्रोफाइल सेव्ह होऊ शकले नाही.",
    "nav.general": "सामान्य",
    "nav.community": "समुदाय",
    "nav.operations": "ऑपरेशन्स",
    "nav.ministry": "मिनिस्ट्री",
    "nav.admin": "अॅडमिन",
    "nav.home": "होम",
    "nav.aiPastor": "AI पास्टर",
    "nav.readMe": "रीड मी",
    "nav.appDownloads": "अॅप डाउनलोड",
    "nav.sermons": "प्रवचने",
    "nav.prayerRequests": "प्रार्थना विनंत्या",
    "nav.tasks": "कामे",
    "nav.users": "वापरकर्ते",
    "nav.teams": "टीम्स",
    "nav.roles": "भूमिका",
    "nav.pages": "पेजेस",
    "nav.attendance": "हजेरी",
    "nav.payroll": "पेरोल",
    "nav.costs": "खर्च",
    "nav.marriage": "विवाह",
    "nav.baptism": "बाप्तिस्मा",
    "nav.counselling": "समुपदेशन",
    "nav.adminDashboard": "अॅडमिन डॅशबोर्ड",
    "nav.liveUsers": "लाइव्ह वापरकर्ते",
    "nav.messageCenter": "मेसेज सेंटर",
    "nav.languages": "भाषा",
    "nav.emailClient": "ईमेल क्लायंट",
    "nav.googleDrive": "गूगल ड्राइव्ह",
    "nav.serverFiles": "सर्व्हर फाइल्स",
    "common.addUser": "वापरकर्ता जोडा",
    "common.refresh": "रीफ्रेश",
    "common.search": "शोधा",
    "common.cancel": "रद्द करा",
    "common.save": "सेव्ह करा",
    "common.delete": "हटवा",
    "common.edit": "संपादित करा",
    "common.download": "डाउनलोड",
    "common.upload": "अपलोड",
    "common.send": "पाठवा",
    "common.close": "बंद करा",
    "common.loading": "लोड होत आहे",
    "common.retry": "पुन्हा प्रयत्न",
    "common.noData": "डेटा नाही",
    "common.actions": "कारवाई",
    "common.status": "स्थिती",
    "common.role": "भूमिका",
    "common.name": "नाव",
    "common.email": "ईमेल",
    "common.phone": "फोन",
    "common.date": "तारीख",
    "common.prev": "मागील",
    "common.next": "पुढील",
    "common.clear": "साफ करा",
    "common.done": "झाले",
    "common.reset": "रीसेट",
    "common.add": "जोडा",
    "common.remove": "काढा",
    "common.back": "मागे",
    "common.showing": "दाखवत आहे",
    "common.of": "चे",
    "common.select": "निवडा",
    "common.any": "कोणतेही",
    "common.yes": "होय",
    "common.no": "नाही",
    "common.ascending": "चढत्या क्रमाने",
    "common.descending": "उतरत्या क्रमाने",
    "common.relevance": "प्रासंगिकता",
    "common.joinDate": "सामील झाल्याची तारीख",
    "common.noDataFound": "डेटा सापडला नाही.",
    "page.users.title": "वापरकर्ते",
    "page.users.subtitle": "सदस्य, संपर्क तपशील, भूमिका आणि सेवा संदेश व्यवस्थापित करा.",
    "page.users.editUser": "वापरकर्ता संपादित करा",
    "page.users.searchPlaceholder": "नाव, ईमेल, फोन, भूमिका, कोड शोधा...",
    "page.users.noUsersFound": "वापरकर्ते सापडले नाहीत.",
    "page.users.searchFilters": "शोध फिल्टर",
    "page.users.profileDetails": "प्रोफाइल तपशील",
    "page.users.userPhoto": "वापरकर्ता फोटो",
    "page.users.uploadPhoto": "फोटो अपलोड करा",
    "page.users.uploading": "अपलोड होत आहे...",
    "page.users.remove": "काढा",
    "page.users.welcomeBroadcast": "स्वागत संदेश",
    "page.users.dailyWordBroadcast": "दैनिक वचन",
    "page.users.meetingBroadcast": "सभा संदेश",
    "page.users.message": "संदेश",
    "page.users.channels": "चॅनेल",
    "page.users.recipients": "प्राप्तकर्ते",
    "page.users.filterRecipients": "प्राप्तकर्ते फिल्टर करा...",
    "page.users.selectAll": "सर्व निवडा",
    "page.users.loadingRecipients": "प्राप्तकर्ते लोड होत आहे...",
    "page.users.noRecipientsFound": "प्राप्तकर्ते सापडले नाहीत.",
    "page.users.generating": "तयार होत आहे...",
    "page.users.copyId": "महिमा आयडी कॉपी करा",
    "page.users.joined": "सामील झाले",
    "page.users.primaryPosition": "प्राथमिक पद",
    "form.displayName": "प्रदर्शन नाव",
    "form.username": "वापरकर्तानाव",
    "form.password": "पासवर्ड",
    "form.role": "भूमिका",
    "form.email": "ईमेल",
    "form.phone": "फोन",
    "form.joinDate": "सामील झाल्याची तारीख",
    "form.birthday": "वाढदिवस",
    "form.maritalStatus": "वैवाहिक स्थिती",
    "form.sex": "लिंग",
    "form.age": "वय",
    "form.aadharNumber": "आधार क्रमांक",
    "form.homeAddress": "घरचा पत्ता",
    "form.currentAddress": "सध्याचा पत्ता",
    "form.emergencyPhone": "आपत्कालीन फोन",
    "form.baptismDate": "बाप्तिस्मा तारीख",
    "form.baptismPlace": "बाप्तिस्मा ठिकाण",
    "form.mahimaId": "महिमा आयडी",
    "form.primaryPosition": "प्राथमिक पद",
    "form.notAssigned": "नियुक्त नाही",
    "form.isBaptized": "बाप्तिस्मा झाले",
    "form.isBornAgain": "पुन्हा जन्मलेले",
    "form.isBeliever": "विश्वासू",
    "form.isPastor": "पास्टर",
    "form.payrollEnabled": "वेतनपट सक्षम",
    "form.keepCurrentPassword": "सध्याचा पासवर्ड ठेवा",
    "form.passwordRequired": "पासवर्ड आवश्यक",
    "filter.anyRole": "कोणतीही भूमिका",
    "filter.anyContact": "कोणताही संपर्क",
    "filter.hasEmail": "ईमेल आहे",
    "filter.hasPhone": "फोन आहे",
    "filter.missingEmail": "ईमेल नाही",
    "filter.missingPhone": "फोन नाही",
    "filter.male": "पुरुष",
    "filter.female": "महिला",
    "filter.joinedFrom": "यापासून सामील",
    "filter.joinedTo": "यापर्यंत सामील",
    "filter.sortBy": "क्रमवारी",
    "filter.sortDir": "दिशा",
    "filter.contact": "संपर्क",
    "filter.hasId": "आधार आहे",
    "filter.missingId": "आधार नाही",
    "filter.pastor": "पास्टर",
    "filter.baptized": "बाप्तिस्मा",
    "filter.bornAgain": "पुन्हा जन्मलेले",
    "filter.believer": "विश्वासू",
    "filter.single": "अविवाहित",
    "filter.married": "विवाहित",
    "filter.divorced": "घटस्फोटित",
    "filter.widowed": "विधवा/विधुर",
    "page.members.title": "संघ सदस्य",
    "page.members.subtitle": "सदस्य, भूमिका आणि संघ नेता व्यवस्थापित करा.",
    "page.members.addMember": "सदस्य जोडा",
    "page.members.selectedUser": "निवडलेला वापरकर्ता",
    "page.members.chooseUserBelow": "खाली वापरकर्ता निवडा",
    "page.members.optionalRole": "वैकल्पिक भूमिका",
    "page.members.markLeader": "नेता म्हणून चिन्हांकित करा",
    "page.members.searchUsers": "नाव, ईमेल शोधा",
    "page.members.leader": "नेता",
    "page.members.joined": "सामील झाले",
    "page.members.members": "सदस्य",
    "page.members.loadingMembers": "सदस्य लोड होत आहे...",
    "page.members.noMembers": "अजून सदस्य नाहीत. सदस्य जोडा.",
    "page.members.loadingUsers": "वापरकर्ते लोड होत आहे...",
    "page.members.noUsers": "वापरकर्ते सापडले नाहीत.",
    "page.members.editRole": "भूमिका संपादित करा",
    "page.members.setLeader": "नेता बनवा",
    "page.members.unsetLeader": "नेता काढा",
    "page.members.removeMember": "सदस्य काढा",
    "page.members.addUser": "वापरकर्ता जोडा",
    "page.members.useUser": "वापरकर्ता वापरा",
    "page.members.refreshTeams": "संघ रिफ्रेश करा",
    "page.members.alreadyInTeam": "आधीच संघात आहे",
    "page.members.refreshMembers": "सदस्य रिफ्रेश करा",
    "page.members.back": "मागे",
  },
};

const PHRASE_KEYS = [
  "nav.home",
  "nav.aiPastor",
  "nav.readMe",
  "nav.appDownloads",
  "nav.sermons",
  "nav.prayerRequests",
  "nav.tasks",
  "nav.users",
  "nav.teams",
  "nav.roles",
  "nav.pages",
  "nav.attendance",
  "nav.payroll",
  "nav.costs",
  "nav.marriage",
  "nav.baptism",
  "nav.counselling",
  "nav.adminDashboard",
  "nav.liveUsers",
  "nav.messageCenter",
  "nav.languages",
  "nav.emailClient",
  "nav.googleDrive",
  "nav.serverFiles",
  "common.addUser",
  "common.refresh",
  "common.search",
  "common.cancel",
  "common.save",
  "common.delete",
  "common.edit",
  "common.download",
  "common.upload",
  "common.send",
  "common.close",
  "common.loading",
  "common.retry",
  "common.noData",
  "common.actions",
  "common.status",
  "common.role",
  "common.name",
  "common.email",
  "common.phone",
  "common.date",
  "common.prev",
  "common.next",
  "common.clear",
  "common.done",
  "common.reset",
  "common.add",
  "common.remove",
  "common.back",
  "common.showing",
  "common.of",
  "common.select",
  "common.any",
  "common.yes",
  "common.no",
  "common.ascending",
  "common.descending",
  "common.relevance",
  "common.joinDate",
  "common.noDataFound",
  "page.users.title",
  "page.users.subtitle",
  "page.users.editUser",
  "page.users.searchPlaceholder",
  "page.users.noUsersFound",
  "page.users.searchFilters",
  "page.users.profileDetails",
  "page.users.userPhoto",
  "page.users.uploadPhoto",
  "page.users.uploading",
  "page.users.remove",
  "page.users.welcomeBroadcast",
  "page.users.dailyWordBroadcast",
  "page.users.meetingBroadcast",
  "page.users.message",
  "page.users.channels",
  "page.users.recipients",
  "page.users.filterRecipients",
  "page.users.selectAll",
  "page.users.loadingRecipients",
  "page.users.noRecipientsFound",
  "page.users.generating",
  "page.users.copyId",
  "page.users.joined",
  "page.users.primaryPosition",
  "form.displayName",
  "form.username",
  "form.password",
  "form.role",
  "form.email",
  "form.phone",
  "form.joinDate",
  "form.birthday",
  "form.maritalStatus",
  "form.sex",
  "form.age",
  "form.aadharNumber",
  "form.homeAddress",
  "form.currentAddress",
  "form.emergencyPhone",
  "form.baptismDate",
  "form.baptismPlace",
  "form.mahimaId",
  "form.primaryPosition",
  "form.notAssigned",
  "form.isBaptized",
  "form.isBornAgain",
  "form.isBeliever",
  "form.isPastor",
  "form.payrollEnabled",
  "form.keepCurrentPassword",
  "form.passwordRequired",
  "filter.anyRole",
  "filter.anyContact",
  "filter.hasEmail",
  "filter.hasPhone",
  "filter.missingEmail",
  "filter.missingPhone",
  "filter.male",
  "filter.female",
  "filter.joinedFrom",
  "filter.joinedTo",
  "filter.sortBy",
  "filter.sortDir",
  "filter.contact",
  "filter.hasId",
  "filter.missingId",
  "filter.pastor",
  "filter.baptized",
  "filter.bornAgain",
  "filter.believer",
  "filter.single",
  "filter.married",
  "filter.divorced",
  "filter.widowed",
  "page.members.title",
  "page.members.subtitle",
  "page.members.addMember",
  "page.members.selectedUser",
  "page.members.chooseUserBelow",
  "page.members.optionalRole",
  "page.members.markLeader",
  "page.members.searchUsers",
  "page.members.leader",
  "page.members.joined",
  "page.members.members",
  "page.members.loadingMembers",
  "page.members.noMembers",
  "page.members.loadingUsers",
  "page.members.noUsers",
  "page.members.editRole",
  "page.members.setLeader",
  "page.members.unsetLeader",
  "page.members.removeMember",
  "page.members.addUser",
  "page.members.useUser",
  "page.members.refreshTeams",
  "page.members.alreadyInTeam",
  "page.members.refreshMembers",
  "page.members.back",
];

const TRANSLATION_CACHE_KEY = "mahima_ui_translation_cache_v4";
const TRANSLATABLE_ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"];
const originalTextByNode = new WeakMap();
const translatedTextByNode = new WeakMap();
let translationCacheMemory = null;

const LANGUAGE_NAMES = {
  en: "English",
  hi: "Hindi",
  pa: "Punjabi",
  or: "Odia",
  ta: "Tamil",
  mr: "Marathi",
  ne: "Nepali",
};

const BUILT_IN_LANGUAGE_BY_CODE = new Map(
  REQUIRED_UI_LANGUAGES.map((language) => [language.code, language])
);

function looksLikeMojibake(value) {
  return /[ÃÂ\uFFFD]|à[¤¥¦§¨©ª«¬®¯]/.test(String(value || ""));
}

function mergeLanguages(apiLanguages = [], includeFallback = false) {
  const map = new Map();
  if (includeFallback) REQUIRED_UI_LANGUAGES.forEach((language) => map.set(language.code, { ...language }));
  (Array.isArray(apiLanguages) ? apiLanguages : []).forEach((language) => {
    if (!language?.code) return;
    const code = String(language.code).trim().toLowerCase();
    const existing = map.get(code) || {};
    const builtIn = BUILT_IN_LANGUAGE_BY_CODE.get(code);
    const merged = { ...existing, ...language, code, enabled: language.enabled !== false };

    if (builtIn) {
      map.set(code, {
        ...merged,
        name: builtIn.name,
        nativeName: builtIn.nativeName,
        rtl: builtIn.rtl,
      });
      return;
    }

    if (looksLikeMojibake(merged.nativeName)) {
      merged.nativeName = merged.name || code.toUpperCase();
    }

    map.set(code, merged);
  });
  return Array.from(map.values())
    .filter((language) => language.enabled !== false)
    .sort((a, b) => Number(a.displayOrder ?? 999) - Number(b.displayOrder ?? 999));
}

function buildPhraseMap(lang) {
  const active = dictionaries[lang] || dictionaries.en || {};
  const english = dictionaries.en || {};
  const map = new Map();
  PHRASE_KEYS.forEach((key) => {
    const target = active[key] || english[key];
    if (!target) return;
    Object.values(dictionaries).forEach((dictionary) => {
      const source = dictionary?.[key];
      if (source && source !== target) map.set(source, target);
    });
  });
  return map;
}

function translateExactText(text, phraseMap) {
  if (!text || phraseMap.size === 0) return text;
  const leading = text.match(/^\s*/)?.[0] || "";
  const trailing = text.match(/\s*$/)?.[0] || "";
  const core = text.trim();
  if (!core) return text;
  const translated = phraseMap.get(core);
  return translated ? `${leading}${translated}${trailing}` : text;
}

function getTranslationCache() {
  if (translationCacheMemory) return translationCacheMemory;
  try {
    translationCacheMemory = JSON.parse(localStorage.getItem(TRANSLATION_CACHE_KEY) || "{}") || {};
  } catch {
    translationCacheMemory = {};
  }
  return translationCacheMemory;
}

function saveTranslationCache() {
  try {
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(translationCacheMemory || {}));
  } catch {}
}

function rememberTranslations(lang, translations) {
  if (!lang || !translations || typeof translations !== "object") return;
  const cache = getTranslationCache();
  cache[lang] = cache[lang] || {};
  Object.entries(translations).forEach(([source, translated]) => {
    const key = String(source || "").trim();
    const value = String(translated || "").trim();
    if (key && value) cache[lang][key] = value;
  });
  saveTranslationCache();
}

function getCachedTranslation(lang, text) {
  const key = String(text || "").trim();
  if (!lang || !key) return "";
  return getTranslationCache()?.[lang]?.[key] || "";
}

function applyTranslatedText(original, translated) {
  const source = String(original || "");
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  const value = String(translated || "").trim();
  return value ? `${leading}${value}${trailing}` : source;
}

function isLikelyUserOrRecordText(text, parent) {
  const core = String(text || "").replace(/\s+/g, " ").trim();
  if (!core) return true;
  if (core.length < 2 || core.length > 260) return true;
  if (/https?:\/\/|www\.|@/.test(core)) return true;
  if (/^[\d\s.,:/\\\-+()%$#]+$/.test(core)) return true;
  if (/^(MHN|INV|TXN|JE|GL|GST|PAN|TAN|IFSC)[A-Z0-9_-]*$/i.test(core)) return true;
  if (/^\+?\d[\d\s()-]{6,}$/.test(core)) return true;
  if (/^[A-Z0-9_-]{3,30}$/.test(core) && !/\s/.test(core)) return true;

  const dynamicParent = parent?.closest?.(
    [
      "[data-no-ui-translate]",
      "[data-user-content]",
      "[data-dynamic-content]",
      ".chat-message",
      ".message-bubble",
      ".chat-bubble",
      ".message-text",
      ".chat-list",
      ".chat-list-item",
      ".mail-message",
      ".mail-body",
      ".file-row",
      ".ledger-row",
      ".transaction-row",
      ".avatar",
      ".user-avatar",
      ".profile-avatar",
    ].join(",")
  );
  if (dynamicParent) return true;

  const words = core.split(/\s+/).filter(Boolean);
  const looksLikeName = words.length <= 3 && words.every((word) => /^[A-Z][a-z.'-]{1,24}$/.test(word));
  const headingOrControl = /^(H[1-6]|BUTTON|LABEL|A)$/i.test(parent?.tagName || "");
  return looksLikeName && !headingOrControl;
}

async function fetchRemoteTranslations(lang, texts) {
  const unique = Array.from(new Set((texts || []).map((text) => String(text || "").trim()).filter(Boolean))).slice(0, 30);
  if (!unique.length || lang === "en") return {};

  try {
    const response = await apiFetch("/ui-translation/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 15000,
      body: JSON.stringify({
        language: lang,
        languageName: LANGUAGE_NAMES[lang] || lang,
        texts: unique,
      }),
    });

    return response?.translations && typeof response.translations === "object"
      ? response.translations
      : {};
  } catch (error) {
    console.warn("Page translation API unavailable.", error?.message || error);
    return {};
  }
}

function shouldSkipElement(element) {
  if (!element) return true;
  if (element.closest("[data-no-auto-translate],[data-no-ui-translate]")) return true;
  const tag = element.tagName;
  return ["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE", "TIME"].includes(tag);
}

function isStaticUiText(parent, text, phraseMap) {
  const core = String(text || "").trim();
  if (!core) return false;
  if (phraseMap.has(core)) return true;

  const tag = parent?.tagName || "";
  if (/^(H1|H2|H3|H4|H5|H6|BUTTON|LABEL|TH|LEGEND)$/i.test(tag)) return true;

  if (parent?.closest?.("button,label,th,legend,[role='button'],[data-ui-translate],[data-static-ui]")) return true;

  // Also translate elements whose className contains common UI-text indicators
  const cls = (parent?.className || "");
  if (typeof cls === "string" && /subtitle|description|hint|caption|section-label|page-label|empty|alert|stat|badge-label/i.test(cls)) {
    return true;
  }

  return false;
}

function setTranslatedNodeValue(node, next) {
  if (node.nodeValue !== next) node.nodeValue = next;
  translatedTextByNode.set(node, next);
}

function collectTextNodes(root) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT;
      const text = node.nodeValue || "";
      if (!text.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function translateAttributes(root, phraseMap, lang) {
  if (!root || lang === "en") return;
  const elements = [root, ...Array.from(root.querySelectorAll?.("*") || [])].filter(Boolean);
  elements.forEach((element) => {
    if (shouldSkipElement(element)) return;
    TRANSLATABLE_ATTRIBUTES.forEach((attribute) => {
      const current = element.getAttribute?.(attribute);
      if (!current || !current.trim()) return;
      const sourceKey = `data-mahima-source-${attribute.replace(/[^a-z0-9]+/gi, "-")}`;
      if (!element.hasAttribute(sourceKey)) element.setAttribute(sourceKey, current);
      const source = element.getAttribute(sourceKey) || current;
      const exact = translateExactText(source, phraseMap);
      element.setAttribute(attribute, exact);
    });
  });
}

async function translateTree(root, phraseMap, lang) {
  if (!root || lang === "en") return;
  translateAttributes(root, phraseMap, lang);

  const pending = new Map();
  const nodes = collectTextNodes(root);
  nodes.forEach((node) => {
    const current = node.nodeValue || "";
    const previousTranslated = translatedTextByNode.get(node);
    if (!originalTextByNode.has(node) || (previousTranslated && current !== previousTranslated)) {
      originalTextByNode.set(node, current);
      translatedTextByNode.delete(node);
    }

    const source = originalTextByNode.get(node) || current;
    const core = source.replace(/\s+/g, " ").trim();
    if (!core) return;

    const exact = translateExactText(source, phraseMap);
    if (exact !== source) {
      setTranslatedNodeValue(node, exact);
      return;
    }

    const cached = getCachedTranslation(lang, core);
    if (cached) {
      const next = applyTranslatedText(source, cached);
      setTranslatedNodeValue(node, next);
      return;
    }

    if (!/[A-Za-z]/.test(core)) return;
    if (isLikelyUserOrRecordText(core, node.parentElement)) return;
    if (!isStaticUiText(node.parentElement, core, phraseMap)) return;
    if (!pending.has(core)) pending.set(core, []);
    pending.get(core).push(node);
  });

  if (!pending.size) return;

  const translations = await fetchRemoteTranslations(lang, Array.from(pending.keys()));
  rememberTranslations(lang, translations);

  pending.forEach((pendingNodes, sourceText) => {
    const translated = translations?.[sourceText];
    if (!translated) return;
    pendingNodes.forEach((node) => {
      const source = originalTextByNode.get(node) || "";
      if (source.replace(/\s+/g, " ").trim() !== sourceText) return;
      const next = applyTranslatedText(source, translated);
      setTranslatedNodeValue(node, next);
    });
  });
}

function GlobalTextTranslator({ lang, rtl }) {
  useEffect(() => {
    const phraseMap = buildPhraseMap(lang);
    document.documentElement.lang = lang || "en";
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.body?.classList.toggle("mahima-rtl", Boolean(rtl));
    if (!lang || lang === "en") return undefined;

    let timer = 0;
    let runId = 0;
    const run = () => {
      window.clearTimeout(timer);
      const currentRun = ++runId;
      timer = window.setTimeout(() => {
        translateTree(document.body, phraseMap, lang).catch((error) => {
          if (currentRun === runId) console.warn("Page translation failed.", error?.message || error);
        });
      }, 180);
    };

    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [lang, rtl]);

  return null;
}

const LanguageContext = createContext({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
  translateText: (text) => text,
  languages: REQUIRED_UI_LANGUAGES,
  defaultLang: "en",
  refreshLanguages: () => {},
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      return localStorage.getItem("mahima_lang") || "en";
    } catch {
      return "en";
    }
  });

  const [languages, setLanguages] = useState(() => {
    try {
      const cached = localStorage.getItem("mahima_languages");
      if (cached) {
        const configured = mergeLanguages(JSON.parse(cached));
        if (configured.length) return configured;
      }
    } catch {}
    return REQUIRED_UI_LANGUAGES;
  });

  async function refreshLanguages() {
    try {
      const list = await listEnabledLanguages();
      const next = mergeLanguages(list);
      if (!next.length) throw new Error("No enabled languages are configured.");
      setLanguages(next);
      try { localStorage.setItem("mahima_languages", JSON.stringify(next)); } catch {}
    } catch (e) {
      console.warn("Languages API unreachable, using fallback list.", e?.message || e);
      setLanguages((current) => current.length ? current : REQUIRED_UI_LANGUAGES);
    }
  }

  const loadAuthenticatedPreference = () => {
    if (!getToken()) return;
    getMyPreferredLanguage()
      .then((saved) => { if (saved) setLangState(saved.toLowerCase()); })
      .catch(() => {});
  };

  useEffect(() => {
    refreshLanguages();
    loadAuthenticatedPreference();
    const handleLanguagesUpdated = () => refreshLanguages();
    const handleAuthChanged = (event) => {
      if (event?.detail?.token || getToken()) loadAuthenticatedPreference();
    };
    window.addEventListener("mahima:languages-updated", handleLanguagesUpdated);
    window.addEventListener("auth:change", handleAuthChanged);
    return () => {
      window.removeEventListener("mahima:languages-updated", handleLanguagesUpdated);
      window.removeEventListener("auth:change", handleAuthChanged);
    };
  }, []);

  const defaultLang = useMemo(
    () => languages.find((language) => language.isDefault)?.code || "en",
    [languages]
  );

  useEffect(() => {
    const enabled = new Set(languages.map((language) => language.code));
    if (!enabled.has(lang)) {
      setLangState(defaultLang);
      try { localStorage.setItem("mahima_lang", defaultLang); } catch {}
    }
  }, [defaultLang, lang, languages]);

  const setLang = (value) => {
    const next = String(value || defaultLang).toLowerCase();
    if (!languages.some((language) => language.code === next)) return;
    const previous = lang;
    setLangState(next);
    try { localStorage.setItem("mahima_lang", next); } catch {}
    // Public pages also use this provider. Persist locally for anonymous visitors,
    // and call the protected preference endpoint only after authentication.
    if (getToken()) updateMyPreferredLanguage(next).catch(() => {});
    window.dispatchEvent(new CustomEvent("mahima:language-change", { detail: { lang: next } }));
    if (next === "en" && previous && previous !== "en") {
      window.setTimeout(() => window.location.reload(), 60);
    }
  };

  const value = useMemo(() => {
    const phraseMap = buildPhraseMap(lang);
    return {
      lang,
      setLang,
      t: (key) => dictionaries[lang]?.[key] ?? dictionaries.en?.[key] ?? key,
      translateText: (text) => translateExactText(String(text ?? ""), phraseMap),
      languages,
      defaultLang,
      refreshLanguages,
    };
  }, [defaultLang, lang, languages]);

  const activeLanguage = languages.find((language) => language.code === lang);

  return (
    <LanguageContext.Provider value={value}>
      <GlobalTextTranslator lang={lang} rtl={Boolean(activeLanguage?.rtl)} />
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
