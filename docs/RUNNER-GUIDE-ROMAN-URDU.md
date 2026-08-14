# Runner Guide — Roman Urdu

## Sab se pehle: runner abhi lazmi nahin hai

SynapseX CreatorOS Coding **runner ke baghair bhi chal sakta hai**. Aap project bana sakte hain, ZIP import/export kar sakte hain, file edit kar sakte hain, prompt de sakte hain, code proposal review kar sakte hain, approvals de sakte hain aur changes apply kar sakte hain.

Runner sirf aik **automatic verification machine** hai. Is ka kaam accepted code ko temporary aur isolated environment mein chala kar typecheck, lint, build aur test ke asli nateeje dena hai. Agar runner connect na ho to system changes ko `unverified` dikhata hai, `failed` nahin. Is ka matlab hai ke code apply ho gaya hai lekin automatic test machine ne abhi check nahin kiya.

## PowerShell aur runner mein farq

PowerShell aik command interface hai. Windows machine par maujood PowerShell se commands likhi ja sakti hain, lekin is web application ke server ke paas user ki har machine ka PowerShell access nahin hota. Har coding project ko chalane ke liye us ki apni language aur dependencies bhi chahiye hoti hain: misal ke tor par Node.js, Python, Java, Go, Docker, ya database service.

Runner is liye alag hai taake user ka code web application ke apne server ke andar na chale. Aik alag temporary machine code ko run karti hai, result aur logs wapas bhejti hai, phir apna temporary workspace delete kar deti hai. Yeh security aur reliable testing ke liye hota hai.

## Abhi aap ke liye free aur asaan tareeqa

1. Runner setup **skip** karein.
2. App ko normal tareeqe se publish karein; Command Center ke tamam coding, review aur approval features chalte rahenge.
3. Har important change ke baad GitHub repository mein code push karein.
4. GitHub Actions workflow repository par typecheck, tests aur build chala dega. Public repository ke standard GitHub-hosted runners ke liye GitHub Actions free hai. [1]

Is mode mein in-app `Verification` panel automatic runner result nahin dikhayega; us ki jagah run `unverified` rahega. Real CI nateeja GitHub repository ke **Actions** tab mein milega. Yeh abhi kisi extra server, Docker hosting ya paid runner ke baghair sahi workflow hai.

## Kab runner setup karna chahiye

Runner tab setup karein jab aap chahen ke Command Center ke andar hi har accepted change ke baad automatic test log aur pass/fail result aaye. Is ke liye aap ko Docker wali alag machine chahiye hoti hai. Yeh:

- Apne computer par free ho sakta hai, lekin computer aur runner chalta rehna chahiye.
- Aik private server/container par bhi chal sakta hai, lekin us hosting ka kharcha provider par depend karta hai.
- Abhi is project ke launch ke liye zaroori nahin hai.

Jab aap is stage par pohanchain to `runner/README.md` mein secure Docker command aur required `CODE_RUNNER_URL` / `CODE_RUNNER_TOKEN` documented hain. Runner ko kabhi bhi app server ya GitHub access token ke saath na chalayein.

## App publish karne ka seedha tareeqa

1. Project ka latest checkpoint bana hua ho.
2. Management panel mein **Publish** button kholein.
3. Pehle platform ka free-to-start hosted URL use karein; custom domain baad mein lagaya ja sakta hai.
4. Publish ke baad apne browser se login, workspace creation, ZIP import aur Command Center prompt ka test karein.

Web app ke liye managed hosting use hoti hai; Docker runner ko abhi deploy karne ki zarurat nahin. Agar platform aage chal kar usage ya plan ka prompt dikhaye, publish se pehle us ki displayed conditions review kar lena.

## References

[1]: https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions "GitHub Actions billing"
