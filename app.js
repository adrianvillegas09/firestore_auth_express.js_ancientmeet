const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const formidable = require("formidable");
const PORT = 5001;

const { initializeApp } = require("firebase/app");
const admin = require("firebase-admin");
const {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  getAuth,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  sendEmailVerification,
} = require("firebase/auth");

const {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  where,
  query,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
} = require("firebase/firestore");
const { MD5 } = require("md5-js-tools");
const { deliverEmail } = require("./mailApi");

const timezones = require("./location");

const firebaseConfig = {
};
// Initialize Firebase
const serviceAccount = require("./accountkey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

let firebase_app = initializeApp(firebaseConfig);
let usersArr = [];

const auth = getAuth(firebase_app);
const db = getFirestore(firebase_app);
const website_address = "https://ancientmeet.io/";

// get auth token from request

const getAuthToken = (req, res, next) => {
  if (
    req.headers.authorization &&
    req.headers.authorization.split(" ")[0] === "Bearer"
  ) {
    req.authToken = req.headers.authorization.split(" ")[1];
  } else {
    req.authToken = null;
  }
  next();
};

app.use(cors());
app.use("/api/img", express.static("img"));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/**
 * register
 */

app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const date = new Date();
    console.log(email, password);

    let userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    const userinfoRef = collection(db, "informations");

    await addDoc(userinfoRef, {
      email: email,
      expiretime: date.getTime(),
    });

    await sendEmailVerification(userCredential.user);

    return res.json({ error: null, result: userCredential.user });
  } catch (e) {
    return res.json({ error: e, result: "" });
  }
});

/**
 * download android app
 */

app.get("/api/download_android", (req, res) => {
  res.download("./mobile/ancientmeet.apk");
});

/**
 * login
 */

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    let result = await signInWithEmailAndPassword(auth, email, password);
    const sessionToken = await admin
      .auth()
      .createSessionCookie(result._tokenResponse.idToken, {
        expiresIn: 240 * 3600000,
      });
    return res.json({ error: null, result: { ...result, sessionToken } });
  } catch (e) {
    return res.json({ error: e, result: "" });
  }
});

/**
 * validate through phone
 */

app.post("/api/loginwithphone", async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    console.log(phoneNumber);
    let result = await signInWithPhoneNumber(auth, phoneNumber, null);
    return res.json({ error: null, result });
  } catch (e) {
    return res.json({ error: e, result: "" });
  }
});

/**
 * resend the verification email
 */

app.post("/api/resendEmail", getAuthToken, async (req, res) => {
  try {
    console.log(req.authToken);
    const { user } = req.body;
    console.log(user);
    await sendEmailVerification(user);
    return res.json({ error: null, result: "" });
  } catch (e) {
    return res.json({ error: e, result: "" });
  }
});

app.post("/api/current", getAuthToken, async (req, res) => {
  try {
    // console.log(req.authToken);
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);
    console.log(1);

    if (userInfo.email_verified) {
      return res.json({
        result: true,
        email: userInfo.email,
      });
    } else {
      return res.json({ result: false, email: "" });
    }
  } catch (e) {
    return res.json({ result: false });
  }
});

const listAllUsers = async (nextPageToken) => {
  try {
    const { users, pageToken } = await admin
      .auth()
      .listUsers(1000, nextPageToken);
    users.forEach((user) => {
      usersArr.push(user.email);
    });
    if (pageToken) {
      listAllUsers(pageToken);
    }
  } catch (e) {
    return [];
  }
};

/**
 * get users
 */

app.post("/api/getusers", getAuthToken, async (req, res) => {
  try {
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);

    if (userInfo.email_verified) {
      usersArr = [];
      await listAllUsers();
      usersArr.push("All AncientMeet members");
      usersArr = usersArr.filter((email) => email !== userInfo.email);
      return res.json({ result: usersArr });
    } else {
      return res.json({ result: [] });
    }
  } catch (e) {
    console.log(e);
    return res.json({ result: [] });
  }
});

/**
 *  verify your login info
 */

app.get("/api/verify", getAuthToken, async (req, res) => {
  try {
    // console.log(req.authToken);
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);
    console.log(userInfo);

    const infoRef = collection(db, "informations");
    const q = query(infoRef, where("email", "==", userInfo.email));
    const querySnapshot = await getDocs(q);
    const docs = querySnapshot.docs;

    const doc = docs[0].data();

    if (userInfo.email_verified) {
      return res.json({
        result: true,
        expired: doc.expiretime < new Date().getTime(),
      });
    } else {
      return res.json({ result: false });
    }
  } catch (e) {
    return res.json({ result: false });
  }
});

/**
 * add Instant room
 */

app.post("/api/add_instantroom", getAuthToken, async (req, res) => {
  try {
    const roomRef = collection(db, "instant_rooms");
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);

    if (userInfo.email_verified) {
      const q = query(roomRef, where("roomname", "==", req.body.roomname));
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;

      if (docs.length === 0) {
        await addDoc(roomRef, {
          roomname: req.body.roomname,
          email: userInfo.email,
          isEnded: false,
          userid: req.body.id,
        });
        return res.json({ result: true, reason: null });
      } else {
        const doc0 = docs[0].data();
        if (doc0.isEnded == false && doc0.email === userInfo.email) {
          await setDoc(doc(roomRef, docs[0].id), {
            roomname: req.body.roomname,
            email: userInfo.email,
            isEnded: false,
            userid: req.body.id,
          });
          return res.json({ result: true, reason: null });
        } else {
          return res.json({ result: false, reason: "duplicated" });
        }
      }
    } else {
      return res.json({ result: false, reason: "notverified" });
    }
  } catch (e) {
    return res.json({ result: false, reason: "notlogin" });
  }
});

/**
 * add Instant room
 */

app.post("/api/setmode", async (req, res) => {
  try {
    const roomRef = collection(db, "instant_rooms");
    const q = query(roomRef, where("roomname", "==", req.body.roomname));
    const querySnapshot = await getDocs(q);
    const docs = querySnapshot.docs;

    if (docs.length === 0) {
      return res.json({ result: false });
    } else {
      const doc0 = docs[0].data();
      console.log(doc0);
      if (doc0.isEnded == false && doc0.userid == req.body.id) {
        return res.json({ result: true });
      } else {
        return res.json({ result: false });
      }
    }
  } catch (e) {
    return res.json({ result: false });
  }
});

/**
 * check moderator
 */
app.post("/api/upload_image", getAuthToken, async (req, res) => {
  try {
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);
    let form = new formidable.IncomingForm();
    form.uploadDir = "./img";
    form.keepExtensions = true;
    // console.log(form);

    form.parse(req, async (err, fields, files) => {
      const extension = files.file.originalFilename.split(".")[1];
      fs.renameSync(
        files.file.filepath,
        "./img/" + files.file.newFilename + "." + extension
      );

      const informationRef = collection(db, "informations");
      const q = query(informationRef, where("email", "==", userInfo.email));
      const querySnapshot = await getDocs(q);

      querySnapshot.forEach(async (sdoc) => {
        const data = sdoc.data();
        await setDoc(doc(informationRef, sdoc.id), {
          email: data.email,
          expiretime: data.expiretime,
          logo: files.file.newFilename + "." + extension,
        });
      });

      res.json({ result: files.file.newFilename + "." + extension });
    });
  } catch (e) {
    console.log(e);
    res.json({ result: "undefined" });
  }
});

/**
 * check moderator
 */
app.post("/api/get_image", getAuthToken, async (req, res) => {
  try {
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);

    const informationRef = collection(db, "informations");
    const q = query(informationRef, where("email", "==", userInfo.email));
    const querySnapshot = await getDocs(q);
    const docs = querySnapshot.docs;

    const doc0 = docs[0].data();
    res.json({ result: doc0.logo || undefined });
  } catch (e) {
    console.log(e);
    res.json({ result: undefined });
  }
});

/**
 * check moderator
 */

app.post("/api/check_moderator", async (req, res) => {
  try {
    let record = {};
    let max_startdate = 0;

    const roomRef = collection(db, "instant_rooms");
    console.log(req.body.roomname);

    const q = query(roomRef, where("roomname", "==", req.body.roomname));
    const querySnapshot = await getDocs(q);
    const docs = querySnapshot.docs;

    const doc0 = docs[0].data();

    const date = new Date();

    const paymentRef = collection(db, "payments");
    const payquery = query(paymentRef, where("email", "==", doc0.email));
    const querySnapshot_payment = await getDocs(payquery);
    const paydocs = querySnapshot_payment.docs;

    for (let i in paydocs) {
      record = paydocs[i].data();
      if (record.result === 1 && record.starttime > max_startdate) {
        max_startdate = record.starttime;
      }
    }

    if (max_startdate + 31 * 24 * 60 * 60 * 1000 > date.getTime()) {
      console.log(max_startdate + 31 * 24 * 60 * 60 * 1000 - date.getTime());
      return res.json({ result: true });
    } else {
      return res.json({ result: false });
    }
  } catch (e) {
    return res.json({ result: false });
  }
});

/**
 * Terminate Instant room
 */

app.post("/api/terminate_instantroom", async (req, res) => {
  try {
    const roomRef = collection(db, "instant_rooms");

    const roomname = req.body.roomname.toLowerCase();

    const q = query(roomRef, where("roomname", "==", roomname));
    const querySnapshot = await getDocs(q);

    querySnapshot.forEach(async (sdoc) => {
      const data = sdoc.data();
      await setDoc(doc(roomRef, sdoc.id), {
        roomname: roomname,
        email: data.email,
        isEnded: true,
      });
    });
    return res.json({ result: true });
  } catch (e) {
    return res.json({ result: false });
  }
});

/**
 * Terminate Instant room by time
 */

app.post("/api/terminate_timeroom", getAuthToken, async (req, res) => {
  try {
    let flag = false;
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);
    const roomRef = collection(db, "instant_rooms");

    const roomname = req.body.roomname.toLowerCase();

    const q = query(roomRef, where("roomname", "==", roomname));
    const querySnapshot = await getDocs(q);

    querySnapshot.forEach(async (sdoc) => {
      const data = sdoc.data();
      if (data.email == userInfo.email) {
        flag = true;
        await setDoc(doc(roomRef, sdoc.id), {
          roomname: roomname,
          email: data.email,
          isEnded: true,
        });
      }
    });
    if (flag) return res.json({ result: true });
    else return res.json({ result: false });
  } catch (e) {
    return res.json({ result: false });
  }
});

/**
 * add schedule
 */

app.post("/api/add_schedule", getAuthToken, async (req, res) => {
  try {
    // console.log(req.authToken);
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);
    console.log(userInfo);

    if (userInfo.email_verified) {
      const { invitedusers, title, description, event_id, start, end } =
        req.body;
      const roomRef = collection(db, "instant_rooms");
      const url = MD5.generate(title + description + event_id);

      const q = query(roomRef, where("roomname", "==", url));
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;

      if (docs.length === 0) {
        await addDoc(roomRef, {
          roomname: url,
          email: userInfo.email,
          start,
          end,
          isEnded: false,
        });
      } else {
        return res.json({ result: false });
      }

      const scheduleRef = collection(db, "schedules");
      await addDoc(scheduleRef, { email: userInfo.email, ...req.body });

      const ancient = invitedusers.filter(
        (email) => email == "All AncientMeet members"
      ).length;

      const start_day = new Date(start);
      const end_day = new Date(end);

      let html = `<p>${userInfo.email} Is Inviting You To ${title}; ${description}</p>`;
      const ONE_HOUR = 60 * 60 * 1000;
      html += `<p>Presentation by: The Ancient Society</p>`;
      html += "<p>To Hear All About It, Please Join Us On:</p>";

      timezones.forEach((timezone) => {
        html += `<img src='https://flagcdn.com/48x36/${timezone[
          "countryCode"
        ].toLowerCase()}.png'/ width='20'>`;
        const start_country_day = new Date(
          start_day.getTime() + timezone["utcOffset"] * ONE_HOUR
        )
          .toUTCString()
          .slice(0, 25);
        const end_country_day = new Date(
          end_day.getTime() + timezone["utcOffset"] * ONE_HOUR
        )
          .toUTCString()
          .slice(0, 25);
        html += `&nbsp; ${start_country_day} ~ ${end_country_day} (${timezone["name"]}) <br/>`;
      });

      html += `<p>Join Ancient Meeting</p>`;
      html += `<p><a href=${website_address + url}>${
        website_address + url
      }</a><p><br>`;

      html += `<p>Meeting ID: ${url}</p>`;

      if (ancient) {
        usersArr = [];
        await listAllUsers();
        usersArr = usersArr.filter((email) => email !== userInfo.email);

        let usersSet = new Set([
          ...invitedusers.filter((email) => email != "All AncientMeet members"),
          ...usersArr,
        ]);

        usersSet.forEach((email) => {
          deliverEmail(email, "AncientMeet Support", html);
        });
      } else {
        invitedusers.forEach((email) => {
          deliverEmail(email, "AncientMeet Support", html);
        });
      }
      return res.json({ result: true });
    } else {
      return res.json({ result: false });
    }
  } catch (e) {
    console.log(e);
    return res.json({ result: false });
  }
});

/**
 * update schedule
 */

app.post("/api/update_schedule", getAuthToken, async (req, res) => {
  try {
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);

    if (userInfo.email_verified) {
      const scheduleRef = collection(db, "schedules");
      const roomRef = collection(db, "instant_rooms");
      const { invitedusers, title, description, event_id, start, end } =
        req.body;

      const url = MD5.generate(title + description + event_id);

      let q = query(roomRef, where("roomname", "==", url));
      let querySnapshot = await getDocs(q);
      let docs = querySnapshot.docs;

      if (docs.length == 0) {
        await addDoc(roomRef, {
          roomname: url,
          email: userInfo.email,
          start,
          end,
          isEnded: false,
        });
      }

      console.log(req.body);
      q = query(scheduleRef, where("event_id", "==", req.body.event_id));
      querySnapshot = await getDocs(q);

      querySnapshot.forEach(async (sdoc) => {
        const data = sdoc.data();
        if (data.email === userInfo.email)
          await setDoc(doc(scheduleRef, sdoc.id), {
            ...req.body,
            email: userInfo.email,
          });
      });

      const ancient = invitedusers.filter(
        (email) => email == "All AncientMeet members"
      ).length;

      const start_day = new Date(start);
      const end_day = new Date(end);

      let html = `<p>${userInfo.email} Is Inviting You To ${title}; ${description} [UPDATE]</p>`;
      const ONE_HOUR = 60 * 60 * 1000;
      html += `<p>Presentation by: The Ancient Society</p>`;
      html += "<p>To Hear All About It, Please Join Us On:</p>";

      timezones.forEach((timezone) => {
        html += `<img src='https://flagcdn.com/48x36/${timezone[
          "countryCode"
        ].toLowerCase()}.png'/ width='20'>`;
        const start_country_day = new Date(
          start_day.getTime() + timezone["utcOffset"] * ONE_HOUR
        )
          .toUTCString()
          .slice(0, 25);
        const end_country_day = new Date(
          end_day.getTime() + timezone["utcOffset"] * ONE_HOUR
        )
          .toUTCString()
          .slice(0, 25);
        html += `&nbsp; ${start_country_day} ~ ${end_country_day} (${timezone["name"]}) <br/>`;
      });

      html += `<p>Join Ancient Meeting</p>`;
      html += `<p><a href=${website_address + url}>${
        website_address + url
      }</a><p><br>`;

      html += `<p>Meeting ID: ${url}</p>`;

      if (ancient) {
        usersArr = [];
        await listAllUsers();
        usersArr = usersArr.filter((email) => email !== userInfo.email);

        let usersSet = new Set([
          ...invitedusers.filter((email) => email != "All AncientMeet members"),
          ...usersArr,
        ]);

        usersSet.forEach((email) => {
          deliverEmail(email, "AncientMeet Support", html);
        });
      } else {
        invitedusers.forEach((email) => {
          deliverEmail(email, "AncientMeet Support", html);
        });
      }
      return res.json({ result: true });
    } else {
      console.log(1);
      return res.json({ result: false });
    }
  } catch (e) {
    console.log(e);
    return res.json({ result: false });
  }
});

/**
 * delete schedule
 */

app.post("/api/delete_schedule", getAuthToken, async (req, res) => {
  try {
    // console.log(req.authToken);
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);

    if (userInfo.email_verified) {
      const scheduleRef = collection(db, "schedules");
      const q = query(scheduleRef, where("event_id", "==", req.body.id));
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;
      const doc_id = docs[0].id;

      const { invitedusers, title, description, event_id, start, end } =
        docs[0].data();
      const url = MD5.generate(title + description + event_id);

      const ancient = invitedusers.filter(
        (email) => email == "All AncientMeet members"
      ).length;

      if (ancient) {
        usersArr = [];
        await listAllUsers();
        usersArr = usersArr.filter((email) => email !== userInfo.email);

        let usersSet = new Set([
          ...invitedusers.filter((email) => email != "All AncientMeet members"),
          ...usersArr,
        ]);

        usersSet.forEach((email) => {
          deliverEmail(
            email,
            "AncientMeet Support",
            `<p>${userInfo.email} canceled the meeting invitation ${
              website_address + url
            }</p>`
          );
        });
      } else {
        invitedusers.forEach((email) => {
          deliverEmail(
            email,
            "AncientMeet Support",
            `<p>${userInfo.email} canceled the meeting invitation ${
              website_address + url
            }</p>`
          );
        });
      }

      const scheduledeletedRef = doc(db, "schedules", doc_id);
      await deleteDoc(scheduledeletedRef);

      return res.json({ result: true });
    } else {
      return res.json({ result: false });
    }
  } catch (e) {
    console.log(e);
    return res.json({ result: false });
  }
});

/**
 * get schedules
 */

app.get("/api/get_schedules", getAuthToken, async (req, res) => {
  try {
    let schedules = [];
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);

    if (userInfo.email_verified) {
      const scheduleRef = collection(db, "schedules");
      const q = query(scheduleRef);
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;
      for (let i in docs) {
        const doc = docs[i].data();
        if (doc.email === userInfo.email) {
          schedules.push({
            event_id: doc.event_id,
            title: doc.title,
            maxnumber: doc.maxnumber,
            start: doc.start,
            end: doc.end,
            description: doc.description,
            email: "Me",
            invitedusers: doc.invitedusers,
          });
        } else {
          if (doc.invitedusers) {
            const isInvited = doc.invitedusers.filter(
              (email) =>
                email === "All AncientMeet members" || email === userInfo.email
            ).length;
            if (isInvited) {
              schedules.push({
                event_id: doc.event_id,
                title: doc.title,
                maxnumber: doc.maxnumber,
                start: doc.start,
                end: doc.end,
                description: doc.description,
                email: doc.email,
                invitedusers: doc.invitedusers,
                deletable: false,
                editable: false,
                color: "#50b500",
              });
            }
          }
        }
      }

      return res.json({ result: schedules });
    } else {
      return res.json({ result: [] });
    }
  } catch (e) {
    console.log(e);
    return res.json({ result: [] });
  }
});

/**
 * get notifications
 */

app.post("/api/get_notifications", getAuthToken, async (req, res) => {
  try {
    let notifications = [];
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);

    if (userInfo.email_verified) {
      const scheduleRef = collection(db, "schedules");
      const q = query(scheduleRef);
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;
      for (let i in docs) {
        const doc = docs[i].data();
        if (doc.email != userInfo.email && doc.invitedusers) {
          const isInvited = doc.invitedusers.filter(
            (email) =>
              email === "All AncientMeet members" || email === userInfo.email
          ).length;
          if (isInvited) {
            notifications.push({
              email: doc.email,
              start: doc.start,
              end: doc.end,
            });
          }
        }
      }

      return res.json({ result: notifications });
    } else {
      return res.json({ result: [] });
    }
  } catch (e) {
    console.log(e);
    return res.json({ result: [] });
  }
});

/**
 * get new notifications
 */

app.post("/api/get_newnotifications", getAuthToken, async (req, res) => {
  try {
    let len = 0;
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);
    const { date } = req.body;
    console.log(date);

    if (userInfo.email_verified) {
      const scheduleRef = collection(db, "schedules");
      const q = query(scheduleRef);
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;
      for (let i in docs) {
        const doc = docs[i].data();
        if (
          doc.email != userInfo.email &&
          doc.invitedusers &&
          new Date(doc.end) > new Date(date)
        ) {
          const isInvited = doc.invitedusers.filter(
            (email) =>
              email === "All AncientMeet members" || email === userInfo.email
          ).length;
          if (isInvited) {
            len++;
          }
        }
      }

      return res.json({ result: len });
    } else {
      return res.json({ result: 0 });
    }
  } catch (e) {
    console.log(e);
    return res.json({ result: [] });
  }
});

/**
 * invoice request for ancient payment
 */

app.post("/api/invoice_request", getAuthToken, async (req, res) => {
  try {
    // console.log(req.authToken);
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);
    const date = new Date();

    const dateString = Date.now() + "";
    const { period } = req.body;
    let money = 100;
    if (period == 2) money = 550;
    const invoice_number =
      parseInt(Math.random() * 10000) +
      "" +
      dateString.slice(8, dateString.length - 1);

    if (userInfo.email_verified) {
      const anc = await axios.get(
        "https://ancientscoin.com/ancient/users/getAcprice"
      );
      const { acPrice, message } = anc.data;
      let amount = 0.0;
      if (message === "Success") {
        amount = money / acPrice;
      } else {
        return res.json({ result: false, redirect_url: null });
      }

      const paymentRef = collection(db, "payments");
      let InvoiceForPay = {
        invoice_number: invoice_number,
        email: userInfo.email,
        starttime: date.getTime(),
        result: 0,
        amount: amount,
      };
      if (period == 2) InvoiceForPay["year"] = true;
      await addDoc(paymentRef, InvoiceForPay);
      return res.json({
        result: true,
        redirect_url: `http://ancientscoin.com/payment/?currency=anc&amount=${amount}&invoice=${invoice_number}&req=Meet`,
      });
    } else {
      return res.json({ result: false, redirect_url: null });
    }
  } catch (e) {
    return res.json({ result: false, redirect_url: null });
  }
});

/**
 * invoice validate
 */

app.post("/api/invoice_validate", getAuthToken, async (req, res) => {
  try {
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);

    if (userInfo.email_verified) {
      const { invoice } = req.body;

      const paymentRef = collection(db, "payments");
      const q = query(paymentRef, where("invoice_number", "==", invoice));
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;

      const document = docs[0].data();
      console.log(document);

      const transaction = await axios.post(
        "https://ancientscoin.com/ancient/wallets/paymentInfo",
        {
          invoice: invoice,
          from: "Meet",
          token: "cQyGrKFTBsrFiu6TRPWT58QYo3Y3W5Y",
          paymentType: "meet_escrow",
        }
      );
      let { response, data } = transaction.data;
      console.log(data);
      if (
        response &&
        data &&
        document &&
        document.email === userInfo.email &&
        document.result === 0 &&
        document.amount == data.amount
      ) {
        querySnapshot.forEach(async (sdoc) => {
          await setDoc(doc(paymentRef, sdoc.id), {
            email: userInfo.email,
            starttime: document.starttime,
            invoice_number: document.invoice_number,
            result: 1,
            amount: data.amount,
          });
        });
        return res.json({ result: true });
      } else {
        return res.json({ result: false });
      }
    } else {
      return res.json({ result: false });
    }
  } catch (e) {
    return res.json({ result: false });
  }
});

/**
 * evaluate free or pro version
 */

app.post("/api/evaluate", getAuthToken, async (req, res) => {
  try {
    const userInfo = await admin.auth().verifySessionCookie(req.authToken);
    let record = {};
    let max_startdate = 0;
    let payDays = 31;

    if (userInfo.email_verified) {
      const date = new Date();

      const paymentRef = collection(db, "payments");
      const q = query(paymentRef, where("email", "==", userInfo.email));
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs;

      for (let i in docs) {
        record = docs[i].data();
        if (record.result === 1 && record.starttime > max_startdate) {
          max_startdate = record.starttime;
          if (record.year) payDays = 366;
        }
      }

      if (max_startdate + payDays * 24 * 60 * 60 * 1000 > date.getTime()) {
        console.log(max_startdate + 31 * 24 * 60 * 60 * 1000 - date.getTime());
        return res.json({ result: true });
      } else {
        return res.json({ result: false });
      }
    } else {
      return res.json({ result: false });
    }
  } catch (e) {
    return res.json({ result: false });
  }
});

/**
 * root api
 */

app.get("/api", (req, res) => {
  res.send("Server is running");
});

app.listen(PORT, () => {
  console.log(`server is runing at port ${PORT}`);
});
