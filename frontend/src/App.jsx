import {BrowserRouter as Router, Route, Routes} from 'react-router-dom';
import Home from "./pages/Home";
import ProductList from "./pages/ProductList";
import ProductDetails from "./pages/ProductDetails";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import PrivateRouter from './components/PrivateRouter';

function App() {
    return (
        <Router>
            <div className="flex min-h-screen flex-col">
                <Navbar/>
                <div className="flex-1">
                    <Routes>
                        <Route path="/" element={<Home/>}/>
                        <Route path="/shop" element={<ProductList/>}/>
                        <Route path="/about" element={<About/>}/>
                        <Route path="/contact" element={<Contact/>}/>
                        <Route path="/product/:id" element={<ProductDetails/>}/>
                        <Route path="/cart" element={<CartPage/>}/>
                        <Route element={<PrivateRouter/>}>
                            <Route path="/checkout" element={<CheckoutPage/>}/>
                        </Route>
                        <Route path="/login" element={<Login/>} />
                        <Route path="/signup" element={<Signup/>} />
                    </Routes>
                </div>
                <Footer/>
            </div>
        </Router>
    );
}

export default App;