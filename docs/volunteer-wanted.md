# Ward map: volunteer wanted (draft, not sent)

Status: draft for Saurabh to approve. Nothing has been posted or sent. The
channel (WhatsApp group, Telegram, a friend's network, a college club) is
chosen with Saurabh.

## The check sheet

`data/ward-map-volunteer-check.csv` has 114 rows: the areas and sectors whose
ward number is still only a suggestion (a press report or a guess from the
map). Columns: area, suggested ward, why it needs a check, the source link,
then three empty columns for the volunteer: "Is the ward right? (Yes / No)",
"If No, the right ward", "Your note". It holds no personal data.

## Message (English)

> **Help us get Gurugram's ward map right**
>
> Residents find their ward on our site by typing their sector or colony.
> For 114 places we are not yet sure which of the 36 ward numbers is correct.
> Could you check some of them?
>
> - You need: a phone or laptop, about 1 hour, and a way to look at the
>   official voter list for the 2025 Municipal Corporation election, or to
>   ask a neighbour who knows the ward.
> - We send you a simple sheet. For each place, you mark Yes or No, and give
>   the right ward if No.
> - Pick any 10 to 20 rows. Every row you confirm makes the site more
>   accurate for everyone.
>
> Interested? Send us a note through the Join form on the Gurugram Vision
> Forum website and tell us your area.

## Message (Hindi)

> **गुरुग्राम का वार्ड नक्शा सही करने में मदद करें**
>
> निवासी हमारी साइट पर अपना सेक्टर या कॉलोनी लिखकर अपना वार्ड ढूँढते हैं।
> 114 जगहों के लिए हमें अभी पक्का नहीं पता कि 36 वार्डों में से सही नंबर कौन-सा है।
> क्या आप इनमें से कुछ जाँच सकते हैं?
>
> - आपको चाहिए: एक फ़ोन या लैपटॉप, लगभग 1 घंटा, और 2025 के नगर निगम चुनाव की
>   आधिकारिक मतदाता सूची देखने का तरीका, या किसी जानकार पड़ोसी से पूछना।
> - हम आपको एक सरल शीट भेजेंगे। हर जगह के लिए आप हाँ या नहीं लिखें, और नहीं हो तो सही वार्ड बताएँ।
> - कोई भी 10 से 20 पंक्तियाँ चुनें। आपकी हर पुष्टि सबके लिए साइट को और सही बनाती है।
>
> इच्छुक हैं? गुरुग्राम विज़न फ़ोरम की वेबसाइट के "जुड़ें" फ़ॉर्म से हमें अपने इलाके के साथ संदेश भेजें।

## After the check

Rows marked Yes lose the word `verify` in `data/area-wards.csv` and are
re-seeded; rows marked No get the volunteer's ward and the same note. The
official boundary file from GMDA or MCG, when it arrives, replaces all of
this (asking for it is Saurabh's; if there is no reply by Sat 24 Oct 2026 the
Super EA asks for an RTI draft).
