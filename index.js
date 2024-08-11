const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
    origin: '*',
    credentials: true,
    optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    // bearer token
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' });
        }

        req.decoded = decoded;
        next();
    });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.59h5qtx.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const usersCollection = client.db("sportifyDB").collection("users");
        const classCollection = client.db("sportifyDB").collection("classes");
        const cartCollection = client.db("sportifyDB").collection("carts");
        const paymentCollection = client.db("sportifyDB").collection("payments");
        const enrolledClassCollection = client.db("sportifyDB").collection("enrollments");
        const eventCollection = client.db("sportifyDB").collection("events");
        const testimonialCollection = client.db("sportifyDB").collection("testimonials");
        const factsCollection = client.db("sportifyDB").collection("facts");

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });

        // Warning: use verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }

            next();
        };

        // Warning: use verifyJWT before using verifyInstructor
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }

            next();
        };

        // users related apis 
        app.get('/users', verifyJWT, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'user already exists' });
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // admin related apis 
        // check admin
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ admin: false });
            }

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === 'admin' };
            res.send(result);
        });

        // make admin (only for admin)
        app.patch('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };

            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // instructor related apis 
        // get all instructor 
        app.get('/instructors', async (req, res) => {
            const query = { role: 'instructor' };
            const result = await usersCollection.find(query).toArray();
            res.send(result);
        });

        // get popular instructors 
        app.get('/instructors/popular', async (req, res) => {
            const query = { enrollCount: { $exists: true } };
            const sort = { enrollCount: -1 };
            const result = await usersCollection.find(query).sort(sort).limit(6).toArray();
            res.send(result);
        });

        // instructor stat 
        app.get('/instructor-stats/:name', async(req, res) => {
            const userName = req.params.name;

            const pipeline = [
                {
                    $match: { instructorName: userName, status: 'approved' }
                },
                {
                    $group: {
                        _id: "$instructorName",
                        classes: { $addToSet: "$className" },
                        count: { $sum: 1 }
                    }
                }
            ];

            const result = await classCollection.aggregate(pipeline).toArray();
            res.send(result);
        });

        // check instructor
        app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ instructor: false });
            }

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const result = { instructor: user?.role === 'instructor' };
            res.send(result);
        });

        // make instructor (only for admin)
        app.patch('/users/instructor/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'instructor',
                    enrollCount: 0
                }
            };

            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // class related apis 
        app.get('/classes', async (req, res) => {
            const email = req.query.email;
            let query = {};

            if (email) {
                query = { instructorEmail: email };
            }

            const result = await classCollection.find(query).toArray();
            res.send(result);
        });

        // get popular classes 
        app.get('/classes/popular', async (req, res) => {
            const query = { enrollCount: { $exists: true } };
            const sort = { enrollCount: -1 };
            const result = await classCollection.find(query).sort(sort).limit(6).toArray();
            res.send(result);
        });

        // get approved classes 
        app.get('/classes/approved', async (req, res) => {
            const query = { status: 'approved' };
            const result = await classCollection.find(query).toArray();
            res.send(result);
        });

        // get enrolled classes 
        app.get('/enrolledClasses', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }

            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }

            const query = { email: email };
            const result = await enrolledClassCollection.find(query).toArray();
            res.send(result);
        });

        // get enrolled classes stats
        app.get('/enrollment-stats', async (req, res) => {
            const pipeline = [
                {
                    $group: {
                        _id: "$className",
                        count: { $sum: 1 }
                    }
                },
                { 
                    $project: { 
                        _id: 0, 
                        className: "$_id", 
                        value: "$count"
                    } 
                }
            ];

            const result = await enrolledClassCollection.aggregate(pipeline).toArray();
            res.send(result);
        });

        // upload a class (only for instructor)
        app.post('/classes', verifyJWT, verifyInstructor, async (req, res) => {
            const document = req.body;
            
            const query = { email: document.instructorEmail };
            const instructorInfo = await usersCollection.findOne(query);
            const instructorId = instructorInfo._id;
            
            const classData = { ...document, instructorId };
            const result = await classCollection.insertOne(classData);
            res.send(result);
        });

        // update class info (only for instructor)
        app.patch('/classes/:id', verifyJWT, verifyInstructor, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const document = req.body;
            const updateDoc = {
                $set: {
                    availableSeats: document.availableSeat,
                    price: document.price
                }
            };

            const result = await classCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // update class status (only for admin)
        app.patch('/classes/approved/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const document = req.body;
            const updateDoc = {
                $set: {
                    status: document.status,
                    enrollCount: 0
                }
            };

            const result = await classCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // update class status (only for admin)
        app.patch('/classes/denied/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const document = req.body;
            const updateDoc = {
                $set: {
                    status: document.status
                }
            };

            const result = await classCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // send feedback (only for admin)
        app.patch('/classes/feedback/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const document = req.body;
            const updateDoc = {
                $set: {
                    feedback: document.feedback
                }
            };

            const result = await classCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // cart related apis 
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }

            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }

            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/carts', async (req, res) => {
            const item = req.body;
            const result = await cartCollection.insertOne(item);
            res.send(result);
        });

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        // create payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            });
        });

        // dashboard stats
        app.get('/dashboard-stats', verifyJWT, async (req, res) => {
            const totalUsers = await usersCollection.countDocuments();
            const totalInstructor = await usersCollection.countDocuments({ role: 'instructor' });
            const totalClasses = await classCollection.countDocuments({ status: 'approved' });
            const totalEnrollments = await enrolledClassCollection.countDocuments();
            res.send({ totalUsers, totalInstructor, totalClasses, totalEnrollments });
        });

        // payment related api
        app.get('/totalPayments', verifyJWT, async (req, res) => {
            const result = await paymentCollection.estimatedDocumentCount();
            res.send({ totalPayments: result });
        });

        app.get('/payments', verifyJWT, async (req, res) => {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 10;
            const skip = page * limit;
            const sort = { date: -1 };
            let query = {};

            if (req.query.email) {
                query = { email: req.query.email };
            } 
            
            if (req.query?.page) {
                const result = await paymentCollection.find(query).sort(sort).skip(skip).limit(limit).toArray();
                return res.send(result);
            }

            const result = await paymentCollection.find(query).sort(sort).toArray();
            res.send(result);
        });

        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            // update class information after payment
            const classIds = payment.classIds.map(id => new ObjectId(id));
            const filter1 = { _id: { $in: classIds }, availableSeats: { $gt: 0 } };
            const updateDoc1 = { $inc: { availableSeats: -1, enrollCount: 1 } };
            const updateClassResult = await classCollection.updateMany(filter1, updateDoc1);

            if (updateClassResult.modifiedCount !== classIds.length) {
                // Rollback payment insertion
                const query = { _id: insertResult.insertedId };
                await paymentCollection.deleteOne(query);
                return res.status(400).send({ error: 'One or more classes are full' });
            }

            // update instructor information after payment
            const instructorIds = payment.instructorIds.map(id => new ObjectId(id));
            const filter2 = { _id: { $in: instructorIds } };
            const updateDoc2 = { $inc: { enrollCount: 1 } };
            const bulkUpdateOps = instructorIds.map(instructorId => ({
                updateOne: {
                    filter: { _id: instructorId },
                    update: updateDoc2
                }
            }));
            const updateInstructorResult = await usersCollection.bulkWrite(bulkUpdateOps, { filter2 });

            // delete cart items after payment 
            const cartItemIds = payment.cartItems.map(id => new ObjectId(id));
            const query = { _id: { $in: cartItemIds } };
            const deleteResult = await cartCollection.deleteMany(query);

            // insert information to enrolledClassCollection
            const enrolledClasses = [];
            for (let i = 0; i < payment.classIds.length; i++) {
                const classIdObj = new ObjectId(payment.classIds[i]);
                const query = { _id: classIdObj };
                const classInfo = await classCollection.findOne(query);

                if (classInfo) {
                    enrolledClasses.push({
                        email: payment.email,
                        classId: classInfo._id,
                        image: classInfo.image,
                        className: classInfo.className,
                        instructorName: classInfo.instructorName,
                        instructorEmail: classInfo.instructorEmail,
                        price: classInfo.price,
                        date: payment.date,
                        transactionId: payment.transactionId,
                        status: 'paid'
                    });
                }
            }
            const insertEnrolledResult = await enrolledClassCollection.insertMany(enrolledClasses);

            res.send({ insertResult, updateClassResult, updateInstructorResult, deleteResult, insertEnrolledResult });
        });

        // testimonial related apis 
        app.get('/events', async (req, res) => {
            const result = await eventCollection.find().toArray();
            res.send(result);
        });

        // testimonial related apis 
        app.get('/testimonials', async (req, res) => {
            const result = await testimonialCollection.find().toArray();
            res.send(result);
        });

        // fact related apis 
        app.get('/facts', async (req, res) => {
            const result = await factsCollection.find().toArray();
            res.send(result);
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Sportify Server is running..');
});

app.listen(port, () => {
    console.log(`Sportify is running on port ${port}`);
});